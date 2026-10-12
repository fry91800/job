import type { Prisma, PrismaClient } from "@prisma/client";
import { normalizeCatalogueName } from "@job/shared";

type Db = PrismaClient | Prisma.TransactionClient;

// Skill & occupation extraction for offers (FEATURE M2): dictionary matching of catalogue
// names, as whole words. Skills are searched in the title and description, occupations
// in the title only (descriptions mention other roles). Language unknown = both.
// Loads the name tables on each call: fine for the seed catalogue; cache it once the
// ESCO import makes them large. Short or ambiguous names ("Go") can match common words:
// the AI extraction will replace this for user-added offers.

// A name matches as a whole word: not glued to letters, digits or #+_, and not part of
// a dotted or hyphenated word ("js" must not match inside "node.js"), while a final
// dot or comma still ends the word ("…PostgreSQL.").
function containsWord(text: string, name: string): boolean {
  if (name.length < 2) return false;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const before = "(?<![\\p{L}\\p{N}#+_]|[\\p{L}\\p{N}][.-])";
  const after = "(?![\\p{L}\\p{N}#+_]|[.-][\\p{L}\\p{N}])";
  return new RegExp(`${before}${escaped}${after}`, "u").test(text);
}

export async function extractOfferLinks(db: Db, offer: { title: string; description: string; language: string | null }) {
  const languages = offer.language ? [...new Set([offer.language, "en"])] : ["fr", "en"];
  const [skillNames, occupationNames] = await Promise.all([
    db.skillName.findMany({ where: { language: { in: languages } }, select: { skillId: true, normalizedName: true } }),
    db.occupationName.findMany({ where: { language: { in: languages } }, select: { occupationId: true, normalizedName: true } }),
  ]);

  const title = normalizeCatalogueName(offer.title);
  const fullText = `${title}\n${normalizeCatalogueName(offer.description)}`;
  return {
    skillIds: [...new Set(skillNames.filter((name) => containsWord(fullText, name.normalizedName)).map((name) => name.skillId))],
    occupationIds: [...new Set(occupationNames.filter((name) => containsWord(title, name.normalizedName)).map((name) => name.occupationId))],
  };
}

// Rewrites the offer's catalogue links; call in the same transaction as the offer save.
export async function syncOfferLinks(db: Db, offerId: string, offer: { title: string; description: string; language: string | null }) {
  const { skillIds, occupationIds } = await extractOfferLinks(db, offer);
  await db.offerSkill.deleteMany({ where: { offerId } });
  await db.offerOccupation.deleteMany({ where: { offerId } });
  await db.offerSkill.createMany({ data: skillIds.map((skillId) => ({ offerId, skillId })) });
  await db.offerOccupation.createMany({ data: occupationIds.map((occupationId) => ({ offerId, occupationId })) });
}
