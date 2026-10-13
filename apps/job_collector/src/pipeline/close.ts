import { prisma } from "@job/backend";

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
export async function runMaintenance(now = new Date()): Promise<{ expiredSources: number; closedOffers: number }> {
  const expired = await prisma.offerSource.findMany({ where: { closedAt: null, expiresAt: { lt: now } }, select: { id: true } });
  await prisma.offerSource.updateMany({ where: { id: { in: expired.map((row) => row.id) } }, data: { closedAt: now } });

  // Collected offers (they have sources) whose sources are all closed.
  const orphans = await prisma.offer.findMany({
    where: { closedAt: null, sources: { some: {} }, NOT: { sources: { some: { closedAt: null } } } },
    select: { id: true },
  });
  const { count } = await prisma.offer.updateMany({ where: { id: { in: orphans.map((row) => row.id) } }, data: { closedAt: now } });
  return { expiredSources: expired.length, closedOffers: count };
}
