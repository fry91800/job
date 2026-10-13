import type { Prisma, PrismaClient } from "@prisma/client";
import { matchInText } from "./matcher";

type Db = PrismaClient | Prisma.TransactionClient;
type OfferText = { title: string; description: string; language: string | null };

// Skill & occupation extraction for offers (FEATURE M2): skills from the title and the
// description, occupations from the title only (descriptions mention other roles).
export async function extractOfferLinks(offer: OfferText) {
  const [skillIds, occupationIds] = await Promise.all([
    matchInText("skill", `${offer.title}\n${offer.description}`, offer.language),
    matchInText("occupation", offer.title, offer.language),
  ]);
  return { skillIds, occupationIds };
}

// Rewrites an offer's catalogue links; call in the same transaction as the offer save.
export async function writeOfferLinks(db: Db, offerId: string, links: { skillIds: number[]; occupationIds: number[] }) {
  await db.offerSkill.deleteMany({ where: { offerId } });
  await db.offerOccupation.deleteMany({ where: { offerId } });
  await db.offerSkill.createMany({ data: [...new Set(links.skillIds)].map((skillId) => ({ offerId, skillId })) });
  await db.offerOccupation.createMany({ data: [...new Set(links.occupationIds)].map((occupationId) => ({ offerId, occupationId })) });
}

export async function syncOfferLinks(db: Db, offerId: string, offer: OfferText) {
  await writeOfferLinks(db, offerId, await extractOfferLinks(offer));
}
