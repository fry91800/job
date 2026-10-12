import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import zlib from "node:zlib";
import { config } from "../config";
import { HttpError } from "./http-error";

// Fetches a web page from a URL given by a user (O5), safely:
// * http(s) on the default ports only, no credentials in the URL;
// * the host must resolve to PUBLIC addresses only (no localhost, private networks, cloud
//   metadata 169.254.169.254, IPv6 local ranges…). The check runs in the DNS lookup used
//   for the connection itself, so a host cannot resolve to another address afterwards
//   (DNS rebinding);
// * every redirect is checked the same way; limits on time, size and content type.

const blockedV4 = new net.BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) {
  blockedV4.addSubnet(network, prefix, "ipv4");
}

const blockedV6 = new net.BlockList();
for (const [network, prefix] of [
  ["::", 128], ["::1", 128], ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["100::", 64], ["2001:db8::", 32],
  ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8],
] as const) {
  blockedV6.addSubnet(network, prefix, "ipv6");
}

export function isPublicAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) return !blockedV4.check(address, "ipv4");
  if (family !== 6) return false;
  // IPv4-mapped (::ffff:10.0.0.1) and IPv4-compatible forms: check the IPv4 part.
  const mapped = /^::(ffff:)?(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return isPublicAddress(mapped[2]);
  if (/^::ffff:/i.test(address)) return false;
  return !blockedV6.check(address, "ipv6");
}

const blockedAddress = () => new HttpError(422, "blocked_address", "This address cannot be fetched");
export const pageUnavailable = (reason: string) =>
  new HttpError(422, "page_unavailable", `We couldn't read this page (${reason}). Paste the text of the offer instead.`);

function allowed(address: string): boolean {
  return isPublicAddress(address) || config.fetch.allowedPrivateAddresses.includes(address);
}

// DNS lookup that refuses hosts with any non-public address.
export const safeLookup: net.LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { all: true, family: options.family ?? 0 }, (error, addresses) => {
    if (error) return callback(error, "", 4);
    if (addresses.length === 0 || addresses.some((entry) => !allowed(entry.address))) {
      return callback(Object.assign(new Error("blocked address"), { code: "EBLOCKED" }), "", 4);
    }
    if (options.all) return (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, addresses);
    callback(null, addresses[0].address, addresses[0].family);
  });
};

function checkUrl(url: URL): void {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new HttpError(400, "invalid_url", "Only http(s) addresses can be fetched");
  if (url.username || url.password) throw new HttpError(400, "invalid_url", "Addresses with credentials are not accepted");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const allowedTestHost = config.fetch.allowedPrivateAddresses.includes(host);
  if (url.port && url.port !== "80" && url.port !== "443" && !allowedTestHost) throw blockedAddress();
  if (net.isIP(host) && !allowed(host)) throw blockedAddress();
  if (/^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(host)) throw blockedAddress();
}

type Response = { status: number; headers: http.IncomingHttpHeaders; body: Buffer };

function request(url: URL, signal: AbortSignal): Promise<Response> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const req = client.request(
      url,
      {
        method: "GET",
        lookup: safeLookup,
        signal,
        headers: {
          "User-Agent": config.fetch.userAgent,
          Accept: "text/html,application/xhtml+xml,text/plain;q=0.8",
          "Accept-Encoding": "gzip, deflate, br",
          "Accept-Language": "fr,en;q=0.8",
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        // Redirects and errors: the body is not needed.
        if (status < 200 || status >= 300) {
          res.resume();
          return resolve({ status, headers: res.headers, body: Buffer.alloc(0) });
        }
        const type = String(res.headers["content-type"] ?? "");
        if (!/text\/html|application\/xhtml\+xml|text\/plain/i.test(type)) {
          res.destroy();
          return reject(pageUnavailable("not a web page"));
        }
        const encoding = String(res.headers["content-encoding"] ?? "").toLowerCase();
        const stream =
          encoding === "gzip" ? res.pipe(zlib.createGunzip()) :
          encoding === "deflate" ? res.pipe(zlib.createInflate()) :
          encoding === "br" ? res.pipe(zlib.createBrotliDecompress()) :
          res;
        const chunks: Buffer[] = [];
        let size = 0;
        stream.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > config.fetch.maxBytes) {
            res.destroy();
            stream.destroy();
            reject(pageUnavailable("page too large"));
            return;
          }
          chunks.push(chunk);
        });
        stream.on("end", () => resolve({ status, headers: res.headers, body: Buffer.concat(chunks) }));
        stream.on("error", (error) => reject(error));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

// "text/html; charset=ISO-8859-1", or <meta charset> in the page; UTF-8 by default.
function decode(body: Buffer, contentType: string): string {
  const declared =
    /charset=["']?([\w-]+)/i.exec(contentType)?.[1] ??
    /<meta[^>]+charset=["']?([\w-]+)/i.exec(body.subarray(0, 4096).toString("latin1"))?.[1] ??
    "utf-8";
  try {
    return new TextDecoder(declared).decode(body);
  } catch {
    return new TextDecoder("utf-8").decode(body);
  }
}

export type FetchedPage = { url: string; contentType: string; text: string };

export async function fetchPage(input: string): Promise<FetchedPage> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new HttpError(400, "invalid_url", "Invalid address");
  }
  const signal = AbortSignal.timeout(config.fetch.timeoutMs);

  for (let redirects = 0; ; redirects++) {
    checkUrl(url);
    let response: Response;
    try {
      response = await request(url, signal);
    } catch (error) {
      if (error instanceof HttpError) throw error;
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EBLOCKED") throw blockedAddress();
      if ((error as Error).name === "AbortError" || (error as Error).name === "TimeoutError") throw pageUnavailable("too slow");
      throw pageUnavailable("site unreachable");
    }

    if (response.status >= 300 && response.status < 400 && response.headers.location) {
      if (redirects >= config.fetch.maxRedirects) throw pageUnavailable("too many redirects");
      url = new URL(response.headers.location, url);
      continue;
    }
    // 401/403/429…: login walls and bot protection (e.g. LinkedIn).
    if (response.status < 200 || response.status >= 300) throw pageUnavailable(`HTTP ${response.status}`);

    const contentType = String(response.headers["content-type"] ?? "");
    return { url: url.toString(), contentType, text: decode(response.body, contentType) };
  }
}
