import { createHash } from "node:crypto";
import { Router } from "express";
import { QUEUES } from "@job/backend";
import {
  botPageSchema,
  botPagesRequestSchema,
  botSnapshotSchema,
  collectedOfferSchema,
  ingestRequestSchema,
  type BotPage,
  type BotPagesResponse,
  type BotSnapshotResponse,
  type CollectedOffer,
  type IngestResponse,
  type IngestResult,
} from "@job/shared";
import { HttpError } from "../lib/http-error";
import { prisma } from "../lib/prisma";
import { getQueue } from "../lib/queue";
import { RateLimiter } from "../lib/rate-limit";

// POST /api/collector/ingest (COLLECTOR.md §4): offers from sources that are not
// scheduled connectors (bots, partners). Each offer is validated against the ingestion
// contract here; the job collector processes the accepted ones asynchronously.
export const ingestRouter = Router();

const tokenLimiter = new RateLimiter({ max: 120, windowMs: 60 * 1000 });

async function authenticate(header: string | undefined): Promise<{ id: string; source: string }> {
  const token = /^Bearer\s+(\S+)$/i.exec(header ?? "")?.[1];
  if (!token) throw new HttpError(401, "not_authenticated", "A source token is required");
  const row = await prisma.collectorToken.findUnique({ where: { tokenHash: createHash("sha256").update(token).digest("hex") } });
  if (!row || row.revokedAt) throw new HttpError(401, "invalid_token", "Invalid or revoked token");
  // When the source last sent something: a source that goes quiet is alerted (§17.3).
  await prisma.collectorToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } });
  return { id: row.id, source: row.source };
}

async function authenticateLimited(header: string | undefined) {
  const token = await authenticate(header);
  if (tokenLimiter.isLimited(token.id)) throw new HttpError(429, "rate_limited", "Too many requests, try again later");
  tokenLimiter.record(token.id);
  return token;
}

ingestRouter.post("/ingest", async (req, res) => {
  const token = await authenticateLimited(req.headers.authorization);

  const { offers } = ingestRequestSchema.parse(req.body);
  const results: IngestResult[] = [];
  const accepted: CollectedOffer[] = [];
  offers.forEach((candidate, index) => {
    const parsed = collectedOfferSchema.safeParse(candidate);
    if (!parsed.success) {
      results.push({ index, status: "rejected", errors: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) });
    } else if (parsed.data.source !== token.source) {
      results.push({ index, status: "rejected", errors: [{ path: "source", message: `This token can only send offers of source "${token.source}"` }] });
    } else {
      accepted.push(parsed.data);
      results.push({ index, status: "accepted", source: parsed.data.source, externalId: parsed.data.externalId });
    }
  });

  if (accepted.length > 0) await (await getQueue()).send(QUEUES.ingest, { offers: accepted });
  const response: IngestResponse = { results };
  res.status(202).json(response);
});

// POST /api/collector/pages (COLLECTOR.md §17.2): offer pages seen by a bot, raw. Each page
// is validated here; the collector extracts the offers (JSON-LD, else AI) asynchronously.
ingestRouter.post("/pages", async (req, res) => {
  const token = await authenticateLimited(req.headers.authorization);
  const { pages } = botPagesRequestSchema.parse(req.body);
  const results: BotPagesResponse["results"] = [];
  const accepted: BotPage[] = [];
  pages.forEach((candidate, index) => {
    const parsed = botPageSchema.safeParse(candidate);
    if (!parsed.success) {
      results.push({ index, status: "rejected", errors: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) });
    } else {
      accepted.push(parsed.data);
      results.push({ index, status: "accepted", externalId: parsed.data.externalId });
    }
  });
  if (accepted.length > 0) await (await getQueue()).send(QUEUES.pages, { source: token.source, pages: accepted });
  const response: BotPagesResponse = { results };
  res.status(202).json(response);
});

// POST /api/collector/snapshots (§17.3): every offer id the bot sees in a scope, after a run.
// A complete snapshot closes the scope's offers missing from it (with a safety limit).
ingestRouter.post("/snapshots", async (req, res) => {
  const token = await authenticateLimited(req.headers.authorization);
  const snapshot = botSnapshotSchema.parse(req.body);
  if (snapshot.externalIds.some((id) => !id.startsWith(`${snapshot.scope}:`))) {
    throw new HttpError(400, "invalid_snapshot", `Every id of scope "${snapshot.scope}" must start with "${snapshot.scope}:"`);
  }
  await (await getQueue()).send(QUEUES.snapshot, { source: token.source, snapshot });
  const response: BotSnapshotResponse = { scope: snapshot.scope, received: snapshot.externalIds.length, queued: true };
  res.status(202).json(response);
});
