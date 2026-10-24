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

// Offers seen again without being fetched (still listed, unchanged page, in a snapshot):
// seen now, reopened if they were closed.
export async function markSeen(source: string, externalIds: string[]): Promise<void> {
  if (externalIds.length === 0) return;
  const where = { source, externalId: { in: externalIds } };
  await prisma.offerSource.updateMany({ where, data: { lastSeenAt: new Date(), closedAt: null } });
  const offerIds = (await prisma.offerSource.findMany({ where, select: { offerId: true } })).map((row) => row.offerId);
  await prisma.offer.updateMany({ where: { id: { in: offerIds }, closedAt: { not: null } }, data: { closedAt: null } });
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

// Sources from boards no longer collected (set aside as a duplicate, a feed or a test site,
// paused, gone for good, no offer in France any more): no run closes their offers, so they are closed
// here. Only boards that were collected (they got a company) are looked at; a board's offers
// are "{source}" + "{slug}:…".
async function closeSourcesOfInactiveBoards(now: Date): Promise<number> {
  return prisma.$executeRaw`
    UPDATE offer_sources s SET closed_at = ${now}
    FROM company_sources cs
    WHERE cs.status <> 'active' AND cs.status <> 'candidate' AND cs.company_id IS NOT NULL
      -- Unreachable for now isn't gone: such boards are checked again within days.
      AND NOT (cs.status = 'invalid' AND coalesce(cs.last_error, '') ~* 'unreachable|unknown host')
      AND s.source = cs.ats AND s.closed_at IS NULL
      AND left(s.external_id, length(cs.slug) + 1) = cs.slug || ':'`;
}

export async function runMaintenance(now = new Date()): Promise<{ expiredSources: number; inactiveBoardSources: number; closedOffers: number; prunedRawRecords: number }> {
  const expired = await prisma.offerSource.findMany({ where: { closedAt: null, expiresAt: { lt: now } }, select: { id: true } });
  await prisma.offerSource.updateMany({ where: { id: { in: expired.map((row) => row.id) } }, data: { closedAt: now } });
  const inactiveBoardSources = await closeSourcesOfInactiveBoards(now);

  // Collected offers (they have sources) whose sources are all closed.
  const orphans = await prisma.offer.findMany({
    where: { closedAt: null, sources: { some: {} }, NOT: { sources: { some: { closedAt: null } } } },
    select: { id: true },
  });
  const { count } = await prisma.offer.updateMany({ where: { id: { in: orphans.map((row) => row.id) } }, data: { closedAt: now } });
  return { expiredSources: expired.length, inactiveBoardSources, closedOffers: count, prunedRawRecords: await pruneRawOffers(now) };
}
