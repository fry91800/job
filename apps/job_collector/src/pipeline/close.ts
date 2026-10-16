import { prisma } from "@job/backend";
import { collectorConfig } from "../config";

// Stage 7 (COLLECTOR.md §6): closing offers. Offers are never deleted.

// A source dropped an offer. The offer is closed once all its sources dropped it.
export async function closeSource(source: string, externalId: string, now = new Date()): Promise<boolean> {
  const row = await prisma.offerSource.findUnique({ where: { source_externalId: { source, externalId } } });
  if (!row || row.closedAt) return false;
  await prisma.offerSource.update({ where: { id: row.id }, data: { closedAt: now } });
  return closeOfferIfNoOpenSource(row.offerId, now);
}

async function closeOfferIfNoOpenSource(offerId: string, now: Date): Promise<boolean> {
  const open = await prisma.offerSource.count({ where: { offerId, closedAt: null } });
  if (open > 0) return false;
  const { count } = await prisma.offer.updateMany({ where: { id: offerId, closedAt: null }, data: { closedAt: now } });
  return count > 0;
}

// Daily: sources past their expiry date are closed, then offers without open sources.
// Raw records past their retention (collectorConfig.rawRetention); the latest version of
// each record that became an offer stays.
async function pruneRawOffers(now: Date): Promise<number> {
  const day = 24 * 3600 * 1000;
  const { olderVersionsDays, withoutOfferDays } = collectorConfig.rawRetention;
  const olderVersions = await prisma.$executeRaw`
    DELETE FROM raw_offers r USING (
      SELECT id, row_number() OVER (PARTITION BY source, external_id ORDER BY received_at DESC, id DESC) AS position FROM raw_offers
    ) ranked
    WHERE r.id = ranked.id AND ranked.position > 1 AND r.received_at < ${new Date(now.getTime() - olderVersionsDays * day)}`;
  const withoutOffer = await prisma.$executeRaw`
    DELETE FROM raw_offers r
    WHERE r.received_at < ${new Date(now.getTime() - withoutOfferDays * day)}
      AND NOT EXISTS (SELECT 1 FROM offer_sources s WHERE s.source = r.source AND s.external_id = r.external_id)`;
  return olderVersions + withoutOffer;
}

export async function runMaintenance(now = new Date()): Promise<{ expiredSources: number; closedOffers: number; prunedRawRecords: number }> {
  const expired = await prisma.offerSource.findMany({ where: { closedAt: null, expiresAt: { lt: now } }, select: { id: true } });
  await prisma.offerSource.updateMany({ where: { id: { in: expired.map((row) => row.id) } }, data: { closedAt: now } });

  // Collected offers (they have sources) whose sources are all closed.
  const orphans = await prisma.offer.findMany({
    where: { closedAt: null, sources: { some: {} }, NOT: { sources: { some: { closedAt: null } } } },
    select: { id: true },
  });
  const { count } = await prisma.offer.updateMany({ where: { id: { in: orphans.map((row) => row.id) } }, data: { closedAt: now } });
  return { expiredSources: expired.length, closedOffers: count, prunedRawRecords: await pruneRawOffers(now) };
}
