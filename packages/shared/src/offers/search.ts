import { z } from "zod";
import type { LocationSummary } from "../locations";
import {
  CONTRACT_TYPES,
  DEFAULT_SEARCH_RADIUS_KM,
  MAX_SEARCH_SKILLS,
  PUBLISHED_WITHIN,
  REMOTE_TYPES,
  SALARY_PERIODS,
  SEARCH_RADIUS_CHOICES,
  SEARCH_SORTS,
  type ContractType,
  type RemoteType,
  type SalaryPeriod,
} from "../constants";

// Offer search (FEATURE O1). The web app builds the URL query string from these
// parameters; the API validates the query string with the same schema.

export {
  CONTRACT_TYPES,
  DEFAULT_SEARCH_RADIUS_KM,
  MAX_SEARCH_SKILLS,
  PUBLISHED_WITHIN,
  REMOTE_TYPES,
  SALARY_PERIODS,
  SEARCH_PAGE_SIZE,
  SEARCH_RADIUS_CHOICES,
  SEARCH_SORTS,
  type ContractType,
  type RemoteType,
  type SalaryPeriod,
} from "../constants";

// Query string values arrive as strings; an empty value means "not set".
const emptyToUndefined = (value: unknown) => (value === "" ? undefined : value);

// Lists are comma-separated: `skills=3,12`.
function commaList<T extends z.ZodType>(item: T) {
  return z.preprocess(
    (value) => (typeof value === "string" ? value.split(",").map((part) => part.trim()).filter(Boolean) : value),
    z.array(item),
  );
}

const queryBoolean = z.preprocess((value) => {
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  return value;
}, z.boolean());

const optionalText = (max: number) => z.preprocess(emptyToUndefined, z.string().trim().min(1).max(max).optional());

export const offerSearchSchema = z.object({
  q: optionalText(200),
  locationId: z.preprocess(emptyToUndefined, z.coerce.number().int().positive().optional()),
  radius: z.preprocess(emptyToUndefined, z.coerce.number().pipe(z.literal(SEARCH_RADIUS_CHOICES)).default(DEFAULT_SEARCH_RADIUS_KM)),
  includeRemote: z.preprocess(emptyToUndefined, queryBoolean.default(true)),
  skills: z.preprocess(emptyToUndefined, commaList(z.coerce.number().int().positive()).pipe(z.array(z.number()).max(MAX_SEARCH_SKILLS)).default([])),
  company: optionalText(200),
  remoteType: z.preprocess(emptyToUndefined, commaList(z.enum(REMOTE_TYPES)).default([])),
  contractType: z.preprocess(emptyToUndefined, commaList(z.enum(CONTRACT_TYPES)).default([])),
  publishedWithin: z.preprocess(emptyToUndefined, z.enum(PUBLISHED_WITHIN).optional()),
  salaryMin: z.preprocess(emptyToUndefined, z.coerce.number().int().nonnegative().optional()),
  salaryCurrency: z.preprocess(emptyToUndefined, z.string().regex(/^[A-Za-z]{3}$/).transform((value) => value.toUpperCase()).default("EUR")),
  salaryPeriod: z.preprocess(emptyToUndefined, z.enum(SALARY_PERIODS).default("year")),
  salaryShownOnly: z.preprocess(emptyToUndefined, queryBoolean.default(false)),
  // Relevance by default: keyword and skill matches first, then the most recent (without
  // keywords or skills it is the same as "recent").
  sort: z.preprocess(emptyToUndefined, z.enum(SEARCH_SORTS).default("relevance")),
  page: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(500).default(1)),
});

export type OfferSearchParams = z.infer<typeof offerSearchSchema>;

// How an offer's location relates to the searched location (DATABASE.md "locations").
// `wider_area`: the offer is located in an area containing the search (e.g. a region
// for a city search), shown after exact matches with a "whole region" label.
// `remote`: included only because it is fully remote in the searched country.
export type LocationMatch = "exact" | "wider_area" | "remote";

export type OfferSearchResult = {
  id: string;
  title: string;
  companyName: string | null;
  location: LocationSummary | null;
  locationMatch: LocationMatch | null; // null when no location was searched
  distanceKm: number | null; // city search only, for city offers
  remoteType: RemoteType | null;
  contractType: ContractType | null;
  salary: { min: number | null; max: number | null; currency: string; period: SalaryPeriod } | null;
  publishedAt: string | null;
  collectedAt: string; // when MonPoste found it: "Nouveau" marks since the last visit
  saved: { status: string } | null; // null for anonymous requests or unsaved offers
  skillIds: number[]; // for the match % computed by the web app (FEATURE O4)
  occupationIds: number[];
};

export type OfferSearchResponse = {
  results: OfferSearchResult[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};
