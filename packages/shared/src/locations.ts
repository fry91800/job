import { z } from "zod";
import type { LocationType } from "./constants";

export { LOCATION_TYPES, type LocationType } from "./constants";

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
