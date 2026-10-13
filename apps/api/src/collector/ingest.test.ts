import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { after, before, describe, test } from "node:test";
import type { CollectedOffer, IngestResponse } from "@job/shared";
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
