import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import zlib from "node:zlib";
import { config } from "../config";
import { HttpError } from "./http-error";
import { fetchPage, isPublicAddress, safeLookup } from "./safe-fetch";

const OFFER_HTML = "<html><head><title>Offre</title></head><body><main><h1>Développeur</h1><p>Texte de l'offre.</p></main></body></html>";

let server: http.Server;
let base: string;

before(async () => {
  server = http.createServer((req, res) => {
    switch (req.url) {
      case "/offer":
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(OFFER_HTML);
        break;
      case "/redirect":
        res.writeHead(302, { Location: "/offer" }).end();
        break;
      case "/redirect-private":
        res.writeHead(302, { Location: "http://10.0.0.1/admin" }).end();
        break;
      case "/loop":
        res.writeHead(302, { Location: "/loop" }).end();
        break;
      case "/forbidden":
        res.writeHead(403, { "Content-Type": "text/html" }).end("login required");
        break;
      case "/file":
        res.writeHead(200, { "Content-Type": "application/pdf" }).end("%PDF-1.4");
        break;
      case "/big":
        res.writeHead(200, { "Content-Type": "text/html" }).end("x".repeat(config.fetch.maxBytes + 10));
        break;
      case "/gzip":
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Encoding": "gzip" }).end(zlib.gzipSync(OFFER_HTML));
        break;
      case "/latin1":
        res.writeHead(200, { "Content-Type": "text/html; charset=ISO-8859-1" }).end(Buffer.from("<p>Développeur à Évry</p>", "latin1"));
        break;
      case "/slow":
        // Never answers.
        break;
      default:
        res.writeHead(404).end();
    }
  });
  server.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  config.fetch.allowedPrivateAddresses = [];
  server.closeAllConnections();
  server.close();
});

async function errorCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpError) return error.code;
    throw error;
  }
  return "no error";
}

describe("isPublicAddress", () => {
  test("refuses private, local, link-local and reserved addresses", () => {
    for (const address of [
      "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1",
      "0.0.0.0", "224.0.0.1", "255.255.255.255", "::1", "::", "fc00::1", "fd12::1", "fe80::1", "::ffff:127.0.0.1",
      "::ffff:10.0.0.1", "64:ff9b::a00:1", "not an ip",
    ]) {
      assert.equal(isPublicAddress(address), false, address);
    }
  });

  test("accepts public addresses", () => {
    for (const address of ["8.8.8.8", "93.184.216.34", "172.32.0.1", "2a00:1450:4007:80c::200e", "::ffff:8.8.8.8"]) {
      assert.equal(isPublicAddress(address), true, address);
    }
  });

  test("the DNS lookup refuses hosts resolving to private addresses", async () => {
    const error = await new Promise<NodeJS.ErrnoException | null>((resolve) => safeLookup("localhost", {}, (e) => resolve(e)));
    assert.equal(error?.code, "EBLOCKED");
  });
});

describe("fetchPage", () => {
  test("refuses private targets, odd ports and other schemes before connecting", async () => {
    config.fetch.allowedPrivateAddresses = [];
    for (const url of [`${base}/offer`, "http://localhost/", "http://[::1]/", "http://169.254.169.254/latest/meta-data", "http://10.0.0.1/", "http://intranet.internal/", "https://example.com:8443/"]) {
      assert.equal(await errorCode(fetchPage(url)), "blocked_address", url);
    }
    assert.equal(await errorCode(fetchPage("ftp://example.com/")), "invalid_url");
    assert.equal(await errorCode(fetchPage("https://user:pass@example.com/")), "invalid_url");
  });

  describe("with the local test server allowed", () => {
    before(() => {
      config.fetch.allowedPrivateAddresses = ["127.0.0.1"];
    });
    after(() => {
      config.fetch.allowedPrivateAddresses = [];
    });

    test("fetches an HTML page and follows redirects", async () => {
      const page = await fetchPage(`${base}/redirect`);
      assert.equal(page.url, `${base}/offer`);
      assert.equal(page.text, OFFER_HTML);
    });

    test("every redirect is checked: a redirect to a private address is refused", async () => {
      assert.equal(await errorCode(fetchPage(`${base}/redirect-private`)), "blocked_address");
      assert.equal(await errorCode(fetchPage(`${base}/loop`)), "page_unavailable");
    });

    test("errors, non-HTML files and huge pages are refused", async () => {
      assert.equal(await errorCode(fetchPage(`${base}/forbidden`)), "page_unavailable");
      assert.equal(await errorCode(fetchPage(`${base}/file`)), "page_unavailable");
      assert.equal(await errorCode(fetchPage(`${base}/big`)), "page_unavailable");
    });

    test("decompresses and decodes the declared charset", async () => {
      assert.equal((await fetchPage(`${base}/gzip`)).text, OFFER_HTML);
      assert.equal((await fetchPage(`${base}/latin1`)).text, "<p>Développeur à Évry</p>");
    });

    test("gives up on slow sites", async () => {
      const timeout = config.fetch.timeoutMs;
      config.fetch.timeoutMs = 300;
      try {
        assert.equal(await errorCode(fetchPage(`${base}/slow`)), "page_unavailable");
      } finally {
        config.fetch.timeoutMs = timeout;
      }
    });
  });
});
