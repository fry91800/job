import { z } from "zod";

export const LOCATION_TYPES = ["city", "county", "region", "country"] as const;
export type LocationType = (typeof LOCATION_TYPES)[number];

export type LocationSummary = {
  id: number;
  type: LocationType;
  name: string;
  countryCode: string;
  regionName: string | null;
  countyName: string | null;
};

// GET /api/locations (autocomplete for the search location, FEATURE O1)
export const locationAutocompleteSchema = z.object({
  q: z.string().trim().min(2).max(100),
});

export type LocationAutocompleteResponse = { results: LocationSummary[] };
