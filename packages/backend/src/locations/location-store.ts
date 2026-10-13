import { Prisma } from "@prisma/client";
import type { LocationSummary } from "@job/shared";
import { prisma } from "../prisma";
import type { GeoPlace } from "./geoapify";

// Geoapify places become rows of `locations`, so search and offers use normal ids.
// A place that is already in the table (same type, name, country and codes, e.g. a seeded
// city) reuses that row instead of creating a duplicate.

export function toSummary(row: { id: number; type: string; name: string; countryCode: string; regionName: string | null; countyName: string | null }): LocationSummary {
  return {
    id: row.id,
    type: row.type as LocationSummary["type"],
    name: row.name,
    countryCode: row.countryCode,
    regionName: row.regionName,
    countyName: row.countyName,
  };
}

export async function storePlace(place: GeoPlace) {
  const byProvider = await prisma.location.findUnique({ where: { provider_externalId: { provider: "geoapify", externalId: place.placeId } } });
  if (byProvider) return byProvider;

  const [same] = await prisma.$queryRaw<{ id: number }[]>`
    SELECT id FROM locations
    WHERE type = ${place.type}::location_type
      AND lower(unaccent(name)) = lower(unaccent(${place.name}))
      AND country_code = ${place.countryCode}
      AND region_code IS NOT DISTINCT FROM ${place.regionCode}
      AND county_code IS NOT DISTINCT FROM ${place.countyCode}
    ORDER BY id LIMIT 1`;
  if (same) return prisma.location.findUniqueOrThrow({ where: { id: same.id } });

  const data = {
    provider: "geoapify",
    externalId: place.placeId,
    type: place.type,
    name: place.name,
    countryCode: place.countryCode,
    regionCode: place.regionCode,
    regionName: place.regionName,
    countyCode: place.countyCode,
    countyName: place.countyName,
    latitude: place.latitude,
    longitude: place.longitude,
  };
  try {
    return await prisma.location.create({ data });
  } catch (error) {
    // Two requests storing the same place at once.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return prisma.location.findUniqueOrThrow({ where: { provider_externalId: { provider: "geoapify", externalId: place.placeId } } });
    }
    throw error;
  }
}
