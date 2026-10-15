import { prisma } from "@job/backend";
import { resolveOccupations } from "./enrich";

// Recomputes the occupations of collected offers from their title, after the matching
// rules or the catalogue changed (`npm run collector -- reenrich`). No network: only the
// catalogue and the title rules. Offers whose source gave occupations aren't collected yet
// (no connector gives codes), so every collected offer is recomputed from its title.

export async function reenrichOccupations(options: { log?: (message: string) => void } = {}): Promise<{ offers: number; changed: number }> {
  const log = options.log ?? ((message: string) => console.log(`[reenrich] ${message}`));
  let cursor: string | undefined;
  let offers = 0;
  let changed = 0;
  for (;;) {
    const batch = await prisma.offer.findMany({
      where: { sources: { some: {} } },
      select: { id: true, title: true, language: true, occupations: { select: { occupationId: true } } },
      orderBy: { id: "asc" },
      take: 500,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
    });
    if (batch.length === 0) break;
    for (const offer of batch) {
      const ids = await resolveOccupations({ title: offer.title, occupations: [] }, offer.language);
      const before = new Set(offer.occupations.map((row) => row.occupationId));
      if (ids.length === before.size && ids.every((id) => before.has(id))) continue;
      await prisma.$transaction([
        prisma.offerOccupation.deleteMany({ where: { offerId: offer.id } }),
        prisma.offerOccupation.createMany({ data: ids.map((occupationId) => ({ offerId: offer.id, occupationId })) }),
      ]);
      changed++;
    }
    offers += batch.length;
    cursor = batch[batch.length - 1].id;
    if (offers % 5000 < 500) log(`${offers} offers, ${changed} changed`);
  }
  log(`done: ${offers} offers, ${changed} changed`);
  return { offers, changed };
}
