import { Router } from "express";
import { locationAutocompleteSchema, type LocationSummary } from "@job/shared";
import { prisma } from "../lib/prisma";

export const locationsRouter = Router();

const AUTOCOMPLETE_LIMIT = 10;

// GET /api/locations?q=brun — location autocomplete for search (FEATURE O1).
// Prefix matching ignores accents ("evry" finds "Évry-Courcouronnes").
// Searches the `locations` table only. Geoapify comes later: its results will be
// inserted into `locations` (unique provider + external_id) so that they get an id.
locationsRouter.get("/", async (req, res) => {
  const { q } = locationAutocompleteSchema.parse(req.query);
  const prefix = `${q.replace(/[\\%_]/g, "\\$&")}%`;

  const rows = await prisma.$queryRaw<
    { id: number; type: LocationSummary["type"]; name: string; country_code: string; region_name: string | null; county_name: string | null }[]
  >`
    SELECT id, type::text AS type, name, country_code, region_name, county_name
    FROM locations
    WHERE unaccent(name) ILIKE unaccent(${prefix}) OR ${q} <% name
    ORDER BY unaccent(name) ILIKE unaccent(${prefix}) DESC, word_similarity(${q}, name) DESC, length(name), id
    LIMIT ${AUTOCOMPLETE_LIMIT}
  `;

  res.json({
    results: rows.map((row) => ({
      id: row.id,
      type: row.type,
      name: row.name,
      countryCode: row.country_code,
      regionName: row.region_name,
      countyName: row.county_name,
    })),
  });
});
