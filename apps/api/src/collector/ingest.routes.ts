import { createHash } from "node:crypto";
import { Router } from "express";
import { QUEUES } from "@job/backend";
import { collectedOfferSchema, ingestRequestSchema, type CollectedOffer, type IngestResponse, type IngestResult } from "@job/shared";
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
  return { id: row.id, source: row.source };
}

ingestRouter.post("/ingest", async (req, res) => {
  const token = await authenticate(req.headers.authorization);
  if (tokenLimiter.isLimited(token.id)) throw new HttpError(429, "rate_limited", "Too many requests, try again later");
  tokenLimiter.record(token.id);

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
