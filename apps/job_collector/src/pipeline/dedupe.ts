import { prisma } from "@job/backend";
import { collectorConfig } from "../config";
import type { NormalizedOffer } from "./normalize";
import { textSimilarity } from "./text";

// Stage 4 (COLLECTOR.md §7): is this record an offer we already have?

export type Duplicate = { offerId: string; rule: "same-source" | "same-url" | "fingerprint" };

export async function findDuplicate(offer: NormalizedOffer, fingerprint: string | null): Promise<Duplicate | null> {
  // 1. The same record of the same source.
  const sameSource = await prisma.offerSource.findUnique({
    where: { source_externalId: { source: offer.source, externalId: offer.externalId } },
    select: { offerId: true },
  });
  if (sameSource) return { offerId: sameSource.offerId, rule: "same-source" };

  // 2. The same page (offer URL or apply URL), whatever the source.
  const urls = [offer.url, offer.applyUrl].filter((url): url is string => url !== null);
  if (urls.length) {
    const byUrl =
      (await prisma.offer.findFirst({ where: { url: { in: urls } }, select: { id: true } }))?.id ??
      (await prisma.offerSource.findFirst({ where: { OR: [{ url: { in: urls } }, { applyUrl: { in: urls } }] }, select: { offerId: true } }))?.offerId;
    if (byUrl) return { offerId: byUrl, rule: "same-url" };
  }

  // 3. Same company, title and département, published around the same time, with a
  //    similar description, from another source: two records of one source are two
  //    postings the company chose to publish (the same job in two towns).
  if (fingerprint) {
    const windowMs = collectorConfig.dedupe.publishedWithinDays * 24 * 3600 * 1000;
    const candidates = await prisma.offer.findMany({
      where: { fingerprint, closedAt: null, sources: { none: { source: offer.source } } },
      select: { id: true, description: true, publishedAt: true },
      take: 20,
    });
    for (const candidate of candidates) {
      const close =
        !offer.publishedAt || !candidate.publishedAt || Math.abs(candidate.publishedAt.getTime() - offer.publishedAt.getTime()) <= windowMs;
      if (close && textSimilarity(candidate.description, offer.description) >= collectorConfig.dedupe.minDescriptionSimilarity) {
        return { offerId: candidate.id, rule: "fingerprint" };
      }
    }
  }
  return null;
}
