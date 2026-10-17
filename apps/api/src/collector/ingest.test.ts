import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { after, before, describe, test } from "node:test";
import type { BotPagesResponse, CollectedOffer, IngestResponse } from "@job/shared";
import { prisma, startTestServer } from "../test/helpers";

let server: Awaited<ReturnType<typeof startTestServer>>;
let token: string;
let revoked: string;

const offer = (fields: Partial<CollectedOffer> = {}): CollectedOffer => ({
  contractVersion: 1,
  source: "test-bot",
  externalId: `ext-${randomBytes(4).toString("hex")}`,
  title: "Développeur React",
  description: { format: "text", content: "Une offre de développeur React publiée par une source de test." },
  collectedAt: new Date().toISOString(),
  ...fields,
});

async function createToken(revokedAt: Date | null = null) {
  const value = randomBytes(32).toString("base64url");
  await prisma.collectorToken.create({ data: { source: "test-bot", name: "[test] ingest", tokenHash: createHash("sha256").update(value).digest("hex"), revokedAt } });
  return value;
}

const post = (path: string, body: unknown, bearer?: string) =>
  fetch(new URL(path, server.baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(bearer && { Authorization: `Bearer ${bearer}` }) },
    body: JSON.stringify(body),
  }).then(async (response) => ({ status: response.status, body: await response.json() }));

const jobsOf = async (queue: string) =>
  (await prisma.$queryRaw<{ data: { source: string; pages?: unknown[]; snapshot?: { scope: string } } }[]>`SELECT data FROM pgboss.job WHERE name = ${queue} AND data->>'source' = 'test-bot'`).map((row) => row.data);

const ingest = (body: unknown, bearer?: string) =>
  fetch(new URL("/api/collector/ingest", server.baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(bearer && { Authorization: `Bearer ${bearer}` }) },
    body: JSON.stringify(body),
  }).then(async (response) => ({ status: response.status, body: await response.json() }));

const queuedJobs = async () =>
  (await prisma.$queryRaw<{ count: number }[]>`SELECT count(*)::int AS count FROM pgboss.job WHERE name = 'collector-ingest' AND data::text LIKE '%test-bot%'`)[0].count;

before(async () => {
  server = await startTestServer();
  token = await createToken();
  revoked = await createToken(new Date());
});

after(async () => {
  await prisma.collectorToken.deleteMany({ where: { name: "[test] ingest" } });
  await prisma.$executeRaw`DELETE FROM pgboss.job WHERE name = 'collector-ingest' AND data::text LIKE '%test-bot%'`.catch(() => {});
  await prisma.$executeRaw`DELETE FROM pgboss.job WHERE name IN ('collector-bot-pages', 'collector-bot-snapshot') AND data->>'source' = 'test-bot'`.catch(() => {});
  await server.close();
});

describe("POST /api/collector/ingest", () => {
  test("needs a valid, non-revoked source token", async () => {
    assert.equal((await ingest({ offers: [offer()] })).status, 401);
    assert.equal((await ingest({ offers: [offer()] }, "not-a-token")).body.error.code, "invalid_token");
    assert.equal((await ingest({ offers: [offer()] }, revoked)).status, 401);
  });

  test("validates each offer, accepts the valid ones and queues them for the collector", async () => {
    const valid = offer();
    const { status, body } = await ingest({ offers: [valid, { ...offer(), title: "" }, offer({ source: "other-source" })] }, token);
    assert.equal(status, 202);
    const results = (body as IngestResponse).results;
    assert.deepEqual(results[0], { index: 0, status: "accepted", source: "test-bot", externalId: valid.externalId });
    assert.equal(results[1].status, "rejected");
    assert.deepEqual(results[2].status === "rejected" && results[2].errors[0].path, "source", "a token sends its own source only");
    assert.equal(await queuedJobs(), 1);
  });

  test("batches are limited to 100 offers", async () => {
    const { status } = await ingest({ offers: Array.from({ length: 101 }, () => offer()) }, token);
    assert.equal(status, 400);
  });
});

describe("POST /api/collector/pages (bots)", () => {
  const page = (fields: Record<string, unknown> = {}) => ({ externalId: "site-a:1", url: "https://jobs.example.fr/offres/1", html: "<html><body><h1>Développeur</h1></body></html>", fetchedAt: new Date().toISOString(), ...fields });

  test("needs a source token; pages are validated and queued with the token's source", async () => {
    assert.equal((await post("/api/collector/pages", { pages: [page()] })).status, 401);
    const { status, body } = await post("/api/collector/pages", { pages: [page(), page({ html: undefined }), page({ text: "Texte", html: "<p>x</p>" }), page({ url: "not a url" })] }, token);
    assert.equal(status, 202);
    assert.deepEqual((body as BotPagesResponse).results.map((result) => result.status), ["accepted", "rejected", "rejected", "rejected"]);
    const jobs = await jobsOf("collector-bot-pages");
    assert.equal(jobs.length, 1);
    assert.deepEqual([jobs[0].source, jobs[0].pages?.length], ["test-bot", 1]);
    const used = await prisma.collectorToken.findFirstOrThrow({ where: { name: "[test] ingest", revokedAt: null } });
    assert.ok(used.lastUsedAt, "the token's last use is recorded (quiet-source alert)");
  });

  test("at most 20 pages per request", async () => {
    assert.equal((await post("/api/collector/pages", { pages: Array.from({ length: 21 }, (_, index) => page({ externalId: `site-a:${index}` })) }, token)).status, 400);
  });
});

describe("POST /api/collector/snapshots (bots)", () => {
  test("ids must belong to the scope; the snapshot is queued", async () => {
    const bad = await post("/api/collector/snapshots", { scope: "site-a", externalIds: ["site-a:1", "site-b:2"], complete: true }, token);
    assert.equal(bad.status, 400);
    const { status, body } = await post("/api/collector/snapshots", { scope: "site-a", externalIds: ["site-a:1", "site-a:2"], complete: true }, token);
    assert.equal(status, 202);
    assert.deepEqual(body, { scope: "site-a", received: 2, queued: true });
    assert.deepEqual((await jobsOf("collector-bot-snapshot")).map((job) => job.snapshot?.scope), ["site-a"]);
  });
});
