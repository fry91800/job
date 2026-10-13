import { departementCode, matchInText, matchLabels, matchLocation, prisma } from "@job/backend";
import type { NormalizedOffer } from "./normalize";
import { detectLanguage } from "./text";

// Stage 5 (COLLECTOR.md §6): location, occupations (ROME + ESCO), skills (ESCO), language.

export async function resolveLocation(location: NormalizedOffer["location"]): Promise<{ id: number | null; countyCode: string | null }> {
  if (!location) return { id: null, countyCode: null };
  const country = location.countryCode?.toUpperCase() ?? (location.postcode ? "FR" : null);
  const county = location.countyCode ?? (country === "FR" ? departementCode(null, location.postcode) : null);

  // The city first (table, then Geoapify), else the département, else the country.
  if (location.city) {
    const id = await matchLocation(prisma, { city: location.city, region: null, countryCode: country });
    if (id !== null) {
      const row = await prisma.location.findUnique({ where: { id }, select: { type: true, countyCode: true } });
      if (row?.type === "city") return { id, countyCode: row.countyCode ?? county };
    }
  }
  if (county && country) {
    const row = await prisma.location.findFirst({ where: { type: "county", countryCode: country, countyCode: county }, select: { id: true } });
    if (row) return { id: row.id, countyCode: county };
  }
  if (country) {
    const row = await prisma.location.findFirst({ where: { type: "country", countryCode: country }, select: { id: true } });
    return { id: row?.id ?? null, countyCode: county };
  }
  return { id: null, countyCode: county };
}

// Occupations given by the source (ROME codes, ESCO URIs), else found in the title; each
// completed with its equivalents in the other catalogue (ROME ↔ ESCO correspondence).
export async function resolveOccupations(offer: NormalizedOffer, language: string | null): Promise<number[]> {
  const given = offer.occupations.length
    ? await prisma.occupation.findMany({
        where: { OR: offer.occupations.map(({ scheme, code }) => ({ source: scheme, externalId: code })) },
        select: { id: true },
      })
    : [];
  const ids = given.length ? given.map((row) => row.id) : await matchInText("occupation", offer.title, language);
  if (ids.length === 0) return [];

  const related = await prisma.occupationRelationship.findMany({
    where: { OR: [{ occupationId: { in: ids } }, { relatedOccupationId: { in: ids } }] },
    select: { occupationId: true, relatedOccupationId: true },
  });
  return [...new Set([...ids, ...related.flatMap((row) => [row.occupationId, row.relatedOccupationId])])];
}

export async function resolveSkills(offer: NormalizedOffer, language: string | null): Promise<number[]> {
  const [fromLabels, fromText] = await Promise.all([
    matchLabels("skill", offer.skillLabels, language),
    matchInText("skill", `${offer.title}\n${offer.description}`, language),
  ]);
  return [...new Set([...fromLabels, ...fromText])];
}

export function resolveLanguage(offer: NormalizedOffer): string | null {
  return offer.language ?? detectLanguage(offer.description);
}
