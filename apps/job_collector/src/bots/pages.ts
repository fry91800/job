import { createHash } from "node:crypto";
import { logEvent, prisma } from "@job/backend";
import type { BotPage, CollectedOffer } from "@job/shared";
import { collectorConfig } from "../config";
import { extractJobPostings, frenchPlace, jobPostingOffer } from "../crawler/job-posting";
import { markSeen } from "../pipeline/close";
import { processRecord, type Outcome } from "../pipeline/process";
import { storeRaw } from "../pipeline/raw";
import { aiExtractOffer, BOT_EXTRACT_PROMPT_VERSION } from "./ai-extract";

// Offer pages sent by bots (COLLECTOR.md §17.2), from the queue the API fills
// (POST /api/collector/pages). Per page:
// 1. unchanged since the last time (same content hash in its raw record): only seen;
// 2. JobPosting markup in France: the offer, without AI;
// 3. else AI extraction, within the source's daily budget (a page over budget waits for the
//    bot's next sending);
// 4. pages set aside (not an offer, abroad) are stored raw with the reason, so the same page
//    isn't paid for again (raw records without offer are pruned after 30 days).

export type PageOutcome = Outcome | { result: "seen" | "skipped" | "over-budget"; reason?: string };

export const pageHash = (page: BotPage) => createHash("sha256").update(page.html ?? page.text ?? "").digest("hex");

async function lastPageHash(source: string, externalId: string): Promise<string | null> {
  const row = await prisma.rawOffer.findFirst({ where: { source, externalId }, orderBy: { receivedAt: "desc" }, select: { payload: true } });
  return ((row?.payload ?? null) as { pageHash?: string } | null)?.pageHash ?? null;
}

// AI extractions of the source since midnight (UTC), from their raw records.
async function aiExtractionsToday(source: string): Promise<number> {
  const midnight = new Date();
  midnight.setUTCHours(0, 0, 0, 0);
  const [{ count }] = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT count(*) AS count FROM raw_offers
    WHERE source = ${source} AND received_at >= ${midnight} AND payload->>'extraction' = 'ai'`;
  return Number(count);
}

function fromJobPosting(page: BotPage, source: string): CollectedOffer | null {
  if (!page.html) return null;
  for (const posting of extractJobPostings(page.html)) {
    const place = frenchPlace(posting);
    if (!place) continue;
    const offer = jobPostingOffer(posting, { url: page.url, key: page.externalId, source, siteSlug: "", place });
    return { ...offer, externalId: page.externalId, publishedAt: offer.publishedAt ?? page.publishedAt ?? null };
  }
  return null;
}

export async function processBotPage(source: string, page: BotPage): Promise<PageOutcome> {
  const hash = pageHash(page);
  if ((await lastPageHash(source, page.externalId)) === hash) {
    await markSeen(source, [page.externalId]);
    return { result: "seen" };
  }
  const raw = { url: page.url, pageHash: hash };

  // Structured data first: free and exact.
  const structured = fromJobPosting(page, source);
  if (structured) return processRecord({ raw: { ...raw, extraction: "jsonld" }, offer: structured });
  if (page.html && extractJobPostings(page.html).length > 0) {
    await storeRaw(source, page.externalId, { ...raw, extraction: "jsonld", skipped: "not in France" });
    return { result: "skipped", reason: "not in France" };
  }

  // Then the AI, within the daily budget.
  if ((await aiExtractionsToday(source)) >= collectorConfig.bots.aiPagesPerDay) return { result: "over-budget" };
  const extracted = await aiExtractOffer(page, source);
  const aiRaw = { ...raw, extraction: "ai", promptVersion: BOT_EXTRACT_PROMPT_VERSION };
  if ("skipped" in extracted) {
    await storeRaw(source, page.externalId, { ...aiRaw, skipped: extracted.skipped });
    return { result: "skipped", reason: extracted.skipped };
  }
  return processRecord({ raw: aiRaw, offer: extracted.offer });
}

export async function processBotPages(source: string, pages: BotPage[]): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const page of pages) {
    const outcome = await processBotPage(source, page);
    counts[outcome.result] = (counts[outcome.result] ?? 0) + 1;
    if (outcome.result === "rejected") logEvent("warn", "bot_page_rejected", { source, externalId: page.externalId, reason: outcome.reason });
  }
  if (counts["over-budget"]) logEvent("warn", "bot_ai_budget_reached", { source, pages: counts["over-budget"] });
  return counts;
}
