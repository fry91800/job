import type { LocationType } from "@job/shared";
import { backendConfig as config } from "../config";
import { departementCode } from "./french-departements";

// Geoapify place autocomplete (https://apidocs.geoapify.com/docs/geocoding/autocomplete/).
// Only cities, départements, regions and countries are kept. Results are cached in memory
// to save the daily credits. Any failure returns no results: the local table still answers.

export type GeoPlace = {
  placeId: string;
  type: LocationType;
  name: string;
  countryCode: string;
  regionCode: string | null;
  regionName: string | null;
  countyCode: string | null;
  countyName: string | null;
  latitude: number;
  longitude: number;
};

type GeoapifyResult = {
  place_id?: string;
  result_type?: string;
  name?: string;
  city?: string;
  county?: string;
  state?: string;
  iso3166_2?: string;
  country?: string;
  country_code?: string;
  postcode?: string;
  lat?: number;
  lon?: number;
};

const TYPES: Record<string, LocationType> = { city: "city", county: "county", state: "region", country: "country" };

export function toGeoPlace(result: GeoapifyResult): GeoPlace | null {
  const type = TYPES[result.result_type ?? ""];
  if (!type || !result.place_id || !result.country_code || result.lat === undefined || result.lon === undefined) return null;
  const countryCode = result.country_code.toUpperCase();
  const name = (type === "city" ? result.city ?? result.name : type === "county" ? result.county ?? result.name : type === "region" ? result.state ?? result.name : result.country ?? result.name)?.trim();
  if (!name) return null;
  const hasRegion = type !== "country";
  const hasCounty = type === "city" || type === "county";
  return {
    placeId: result.place_id,
    type,
    name,
    countryCode,
    regionCode: hasRegion ? result.iso3166_2 ?? null : null,
    regionName: hasRegion ? result.state ?? null : null,
    countyCode: hasCounty && countryCode === "FR" ? departementCode(result.county, result.postcode) : null,
    countyName: hasCounty ? result.county ?? null : null,
    latitude: result.lat,
    longitude: result.lon,
  };
}

const cache = new Map<string, { expires: number; places: GeoPlace[] }>();

export function geoapifyEnabled(): boolean {
  return Boolean(config.geoapify.apiKey);
}

export async function geoapifyAutocomplete(text: string, countries = config.geoapify.countries): Promise<GeoPlace[]> {
  if (!geoapifyEnabled()) return [];
  const cacheKey = `${countries.join(",")}|${text.trim().toLowerCase()}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.places;

  const url = new URL("/v1/geocode/autocomplete", config.geoapify.baseUrl);
  url.search = new URLSearchParams({
    text,
    lang: config.geoapify.language,
    limit: "10",
    format: "json",
    ...(countries.length > 0 && { filter: `countrycode:${countries.join(",")}` }),
    apiKey: config.geoapify.apiKey!,
  }).toString();

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(config.geoapify.timeoutMs) });
    if (!response.ok) {
      console.error("geoapify autocomplete failed", response.status);
      return [];
    }
    const body = (await response.json()) as { results?: GeoapifyResult[] };
    const places = (body.results ?? []).map(toGeoPlace).filter((place): place is GeoPlace => place !== null);
    if (cache.size > 5000) cache.clear();
    cache.set(cacheKey, { expires: Date.now() + config.geoapify.cacheTtlMs, places });
    return places;
  } catch (error) {
    console.error("geoapify autocomplete failed", error instanceof Error ? error.message : error);
    return [];
  }
}

export function clearGeoapifyCache(): void {
  cache.clear();
}
