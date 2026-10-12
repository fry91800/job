import type { Prisma, PrismaClient } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

// Finds the location of an extracted place in the `locations` table, by name (accents
// and case ignored): the city if known, else the region, else the country. Returns null
// when nothing matches; the user then picks it with the autocomplete. Geoapify lookups
// will replace this once it is set up.
export async function matchLocation(
  db: Db,
  place: { city: string | null; region: string | null; countryCode: string | null } | null,
): Promise<number | null> {
  if (!place) return null;
  const country = place.countryCode?.toUpperCase() ?? null;

  for (const [type, name] of [["city", place.city], ["region", place.region]] as const) {
    if (!name) continue;
    const rows = await db.$queryRaw<{ id: number }[]>`
      SELECT id FROM locations
      WHERE type = ${type}::location_type
        AND lower(unaccent(name)) = lower(unaccent(${name.trim()}))
        AND (${country}::text IS NULL OR country_code = ${country})
      ORDER BY id LIMIT 1`;
    if (rows.length > 0) return rows[0].id;
  }
  if (country) {
    const row = await db.location.findFirst({ where: { type: "country", countryCode: country }, select: { id: true } });
    if (row) return row.id;
  }
  return null;
}
