import type { LocationAutocompleteResponse, LocationSummary } from "@job/shared";
import { prisma } from "../lib/prisma";
import { geoapifyAutocomplete, geoapifyEnabled, storePlace, toSummary } from "@job/backend";

const LIMIT = 10;
// Geoapify is asked only when the table doesn't already answer well: every place it
// returns is stored, so frequent searches end up answered locally (fewer credits used).
const ENOUGH_LOCAL_RESULTS = 5;
const MIN_GEOAPIFY_QUERY = 3;

async function localResults(q: string): Promise<LocationSummary[]> {
  const prefix = `${q.replace(/[\\%_]/g, "\\$&")}%`;
  const rows = await prisma.$queryRaw<
    { id: number; type: LocationSummary["type"]; name: string; country_code: string; region_name: string | null; county_name: string | null }[]
  >`
    SELECT id, type::text AS type, name, country_code, region_name, county_name
    FROM locations
    WHERE unaccent(name) ILIKE unaccent(${prefix}) OR ${q} <% name
    ORDER BY unaccent(name) ILIKE unaccent(${prefix}) DESC, word_similarity(${q}, name) DESC, length(name), id
    LIMIT ${LIMIT}
  `;
  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    name: row.name,
    countryCode: row.country_code,
    regionName: row.region_name,
    countyName: row.county_name,
  }));
}

// GET /api/locations?q= (FEATURE O1): the `locations` table first, completed by Geoapify.
export async function autocompleteLocations(q: string): Promise<LocationAutocompleteResponse> {
  const local = await localResults(q);
  if (!geoapifyEnabled() || q.trim().length < MIN_GEOAPIFY_QUERY || local.length >= ENOUGH_LOCAL_RESULTS) {
    return { results: local };
  }

  const results = [...local];
  for (const place of await geoapifyAutocomplete(q)) {
    if (results.length >= LIMIT) break;
    const row = await storePlace(place);
    if (!results.some((item) => item.id === row.id)) results.push(toSummary(row));
  }
  return { results };
}
