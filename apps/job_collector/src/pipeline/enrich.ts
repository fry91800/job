import { departementCode, matchInText, matchLabels, matchLocation, prisma } from "@job/backend";
import { collectorConfig } from "../config";
import type { NormalizedOffer } from "./normalize";
import { detectLanguage } from "./text";
import { itOccupationCodes } from "./title-rules";

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

// ROME family occupations (M18 = IT): code → id, loaded once.
let romeFamily: Promise<Map<string, number>> | null = null;
function romeFamilyIds(): Promise<Map<string, number>> {
  romeFamily ??= prisma.occupation
    .findMany({ where: { source: "rome", externalId: { startsWith: collectorConfig.itRome.family } }, select: { id: true, externalId: true } })
    .then((rows) => new Map(rows.map((row) => [row.externalId!, row.id])));
  return romeFamily;
}

// After a catalogue import or in tests.
export function resetOccupationRules(): void {
  romeFamily = null;
}

// Occupations given by the source (ROME codes, ESCO URIs), else found in the title; each
// completed with its equivalents in the other catalogue (ROME ↔ ESCO correspondence).
// From titles, IT (ROME M18) occupations come from the IT title rules only: the
// dictionary's M18 matches mostly come from generic names ("Chef de projet", "Spécialiste
// support", ESCO "project manager") and catch construction or accounting jobs.
export async function resolveOccupations(offer: Pick<NormalizedOffer, "title" | "occupations">, language: string | null): Promise<number[]> {
  const given = offer.occupations.length
    ? await prisma.occupation.findMany({
        where: { OR: offer.occupations.map(({ scheme, code }) => ({ source: scheme, externalId: code })) },
        select: { id: true },
      })
    : [];
  if (given.length) return withRelated(given.map((row) => row.id));

  const family = await romeFamilyIds();
  const ruleIds = itOccupationCodes(offer.title).flatMap((code) => family.get(code) ?? []);
  const familyIds = new Set(family.values());
  const allowed = new Set(ruleIds);
  const ids = [...(await matchInText("occupation", offer.title, language)), ...ruleIds];
  return (await withRelated(ids)).filter((id) => !familyIds.has(id) || allowed.has(id));
}

async function withRelated(ids: number[]): Promise<number[]> {
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
