import assert from "node:assert/strict";
import { createVerify, generateKeyPairSync } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import { config } from "../config";
import { prisma } from "../test/helpers";
import { endpoints, notifyGoogle, notifyIndexNow, withinQuota } from "./indexing";

// Search engines told about new and closed offers (SEO.md), against a local server standing
// in for Google (token and Indexing API) and IndexNow.

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
let server: http.Server;
let base: string;
let received: { path: string; body: string; authorization?: string }[] = [];
let publishStatus = 200;
const ids: string[] = [];
const saved = { ...config.seo.indexing };
const savedEndpoints = { ...endpoints };

before(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      received.push({ path: req.url!, body, authorization: req.headers.authorization });
      if (req.url === "/token") {
        // The JWT must be signed by the service account's key.
        const assertion = new URLSearchParams(body).get("assertion") ?? "";
        const [header, claims, signature] = assertion.split(".");
        const valid = createVerify("RSA-SHA256").update(`${header}.${claims}`).verify(publicKey, signature, "base64url");
        const scope = JSON.parse(Buffer.from(claims, "base64url").toString()).scope;
        return res.writeHead(valid && scope === "https://www.googleapis.com/auth/indexing" ? 200 : 401, { "Content-Type": "application/json" }).end(JSON.stringify(valid ? { access_token: "token-123" } : { error: "invalid_grant" }));
      }
      if (req.url === "/publish") return res.writeHead(publishStatus, { "Content-Type": "application/json" }).end("{}");
      if (req.url === "/indexnow") return res.writeHead(202).end();
      res.writeHead(404).end();
    });
  });
  server.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  Object.assign(endpoints, { googleToken: `${base}/token`, googlePublish: `${base}/publish`, indexNow: `${base}/indexnow` });
});

after(async () => {
  server.close();
  Object.assign(endpoints, savedEndpoints);
  Object.assign(config.seo.indexing, saved);
  await prisma.offer.deleteMany({ where: { id: { in: ids } } });
  await prisma.searchIndexing.deleteMany({});
});

async function offers(start: Date) {
  // Only the offers made here are new: the previous test's are removed, the cursors start now.
  await prisma.offer.deleteMany({ where: { id: { in: ids.splice(0) } } });
  await prisma.searchIndexing.deleteMany({});
  for (const engine of ["google", "indexnow"]) await prisma.searchIndexing.create({ data: { engine, cursorAt: start, day: "", sentToday: 0 } });
  const location = await prisma.location.findFirstOrThrow({ where: { type: "city", countryCode: "FR" } });
  const make = async (fields: Record<string, unknown>) => {
    const offer = await prisma.offer.create({ data: { source: "test-indexing", language: "fr", title: "Offre", description: "Texte.", ...fields } as never });
    ids.push(offer.id);
    return offer.id;
  };
  const withPage = await make({ companyName: "Indexing SAS", locationId: location.id });
  const noPlace = await make({ companyName: "Indexing SAS" }); // no JobPosting: not for Google
  const closed = await make({ companyName: "Indexing SAS", locationId: location.id, closedAt: new Date(Date.now() + 1000) });
  const hidden = await make({ companyName: "Indexing SAS", locationId: location.id, isPublic: false });
  return { withPage, noPlace, closed, hidden };
}

describe("search engine notifications", () => {
  test("the quota: newest offers first, a quarter kept for closed ones", () => {
    const change = (n: number, type: "URL_UPDATED" | "URL_DELETED") => Array.from({ length: n }, (_, index) => ({ url: `u${type}${index}`, type, at: new Date() }));
    const picked = withinQuota(change(300, "URL_UPDATED"), change(100, "URL_DELETED"), 200);
    assert.deepEqual([picked.filter((item) => item.type === "URL_UPDATED").length, picked.filter((item) => item.type === "URL_DELETED").length], [150, 50]);
    assert.equal(withinQuota(change(10, "URL_UPDATED"), change(100, "URL_DELETED"), 200).length, 110, "the rest of the quota goes to closed offers");
    assert.equal(withinQuota(change(10, "URL_UPDATED"), [], 0).length, 0);
  });

  test("IndexNow: every new or closed public offer, with our key; the cursor moves on", async () => {
    const start = new Date(Date.now() - 1000);
    const { withPage, noPlace, closed, hidden } = await offers(start);
    config.seo.indexing.indexNowKey = "0123456789abcdef0123456789abcdef";
    received = [];
    const result = await notifyIndexNow(new Date(Date.now() + 5000));
    assert.equal(result?.sent, 3);
    const body = JSON.parse(received.find((request) => request.path === "/indexnow")!.body);
    assert.equal(body.key, "0123456789abcdef0123456789abcdef");
    assert.match(body.keyLocation, /^https?:\/\/[^/]+\/0123456789abcdef0123456789abcdef\.txt$/, "at the root: a key file only covers its own folder");
    for (const id of [withPage, noPlace, closed]) assert.ok(body.urlList.some((url: string) => url.endsWith(`/offers/${id}`)), id);
    assert.ok(!body.urlList.some((url: string) => url.endsWith(hidden)), "private offers are never sent");
    received = [];
    assert.equal((await notifyIndexNow(new Date(Date.now() + 6000)))?.sent, 0, "nothing new since the last run");
  });

  test("Google: a signed token, offers with JobPosting only, updated or deleted; the quota counted", async () => {
    const start = new Date(Date.now() - 1000);
    const { withPage, closed } = await offers(start);
    config.seo.indexing.googleCredentials = Buffer.from(JSON.stringify({ client_email: "indexing@monposte.iam.gserviceaccount.com", private_key: privateKey })).toString("base64");
    config.seo.indexing.dailyQuota = 190;
    received = [];
    const result = await notifyGoogle(new Date(Date.now() + 5000));
    assert.deepEqual(result, { sent: 2, skipped: 0 });
    const published = received.filter((request) => request.path === "/publish");
    assert.ok(published.every((request) => request.authorization === "Bearer token-123"));
    assert.deepEqual(
      published.map((request) => JSON.parse(request.body)).map((body) => [body.url.split("/offers/")[1], body.type]).sort(),
      [[withPage, "URL_UPDATED"], [closed, "URL_DELETED"]].sort(),
    );
    assert.equal((await prisma.searchIndexing.findUniqueOrThrow({ where: { engine: "google" } })).sentToday, 2);
  });

  test("Google: a key cut short says so, without showing any of it", async () => {
    const whole = JSON.stringify({ client_email: "indexing@monposte.iam.gserviceaccount.com", private_key: privateKey });
    const saved = config.seo.indexing.googleCredentials;
    config.seo.indexing.googleCredentials = Buffer.from(whole.slice(0, 900)).toString("base64");
    try {
      await assert.rejects(notifyGoogle(), (error: Error) => /doesn't decode to a whole key file \(900 characters/.test(error.message) && !error.message.includes("PRIVATE KEY"));
    } finally {
      config.seo.indexing.googleCredentials = saved;
    }
  });

  test("Google: a refused notification leaves the cursor, so the next run tries again", async () => {
    const start = new Date(Date.now() - 1000);
    await offers(start);
    publishStatus = 403;
    try {
      await assert.rejects(notifyGoogle(new Date(Date.now() + 5000)), /HTTP 403/);
      assert.equal((await prisma.searchIndexing.findUniqueOrThrow({ where: { engine: "google" } })).cursorAt.getTime(), start.getTime());
    } finally {
      publishStatus = 200;
    }
  });
});
