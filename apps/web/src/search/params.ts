import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router";
import { CONTRACT_TYPES, DEFAULT_SEARCH_RADIUS_KM, PUBLISHED_WITHIN, REMOTE_TYPES, SEARCH_RADIUS_CHOICES, type ContractType, type RemoteType } from "@job/shared";

// The search lives in the address (FRONTEND.md §2.4): ?q=react&locationId=12&location=Lyon…
// `location` (the place's name) is for display only and isn't sent to the API.

export type SearchState = {
  q: string;
  locationId: number | null;
  locationName: string | null;
  radius: number;
  includeRemote: boolean;
  contractType: ContractType[];
  remoteType: RemoteType[];
  publishedWithin: (typeof PUBLISHED_WITHIN)[number] | null;
  salaryMin: number | null;
  salaryShownOnly: boolean;
  sort: "relevance" | "recent";
};

const list = <T extends string>(value: string | null, allowed: readonly T[]) =>
  (value ?? "").split(",").filter((item): item is T => (allowed as readonly string[]).includes(item));

export function readSearch(params: URLSearchParams): SearchState {
  const number = (key: string) => (params.get(key) && Number.isFinite(Number(params.get(key))) ? Number(params.get(key)) : null);
  const radius = number("radius");
  const published = params.get("publishedWithin");
  return {
    q: params.get("q") ?? "",
    locationId: number("locationId"),
    locationName: params.get("location"),
    radius: radius !== null && (SEARCH_RADIUS_CHOICES as readonly number[]).includes(radius) ? radius : DEFAULT_SEARCH_RADIUS_KM,
    includeRemote: params.get("includeRemote") !== "false",
    contractType: list(params.get("contractType"), CONTRACT_TYPES),
    remoteType: list(params.get("remoteType"), REMOTE_TYPES),
    publishedWithin: (PUBLISHED_WITHIN as readonly string[]).includes(published ?? "") ? (published as SearchState["publishedWithin"]) : null,
    salaryMin: number("salaryMin"),
    salaryShownOnly: params.get("salaryShownOnly") === "true",
    sort: params.get("sort") === "recent" ? "recent" : "relevance",
  };
}

// Only values different from the defaults are written.
export function writeSearch(state: SearchState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.q.trim()) params.set("q", state.q.trim());
  if (state.locationId !== null) {
    params.set("locationId", String(state.locationId));
    if (state.locationName) params.set("location", state.locationName);
    if (state.radius !== DEFAULT_SEARCH_RADIUS_KM) params.set("radius", String(state.radius));
    if (!state.includeRemote) params.set("includeRemote", "false");
  }
  if (state.contractType.length) params.set("contractType", state.contractType.join(","));
  if (state.remoteType.length) params.set("remoteType", state.remoteType.join(","));
  if (state.publishedWithin) params.set("publishedWithin", state.publishedWithin);
  if (state.salaryMin !== null) params.set("salaryMin", String(state.salaryMin));
  if (state.salaryShownOnly) params.set("salaryShownOnly", "true");
  if (state.sort !== "relevance") params.set("sort", state.sort);
  return params;
}

// The API's query string: the address without the display-only place name.
export function apiQuery(state: SearchState): string {
  const params = writeSearch(state);
  params.delete("location");
  params.sort();
  return params.toString();
}

export const activeFilterCount = (state: SearchState) =>
  state.contractType.length + state.remoteType.length + (state.publishedWithin ? 1 : 0) + (state.salaryMin !== null || state.salaryShownOnly ? 1 : 0);

export function useSearchState() {
  const [params, setParams] = useSearchParams();
  const state = useMemo(() => readSearch(params), [params]);
  const update = useCallback(
    (change: Partial<SearchState>) => setParams((current) => writeSearch({ ...readSearch(current), ...change }), { replace: true }),
    [setParams],
  );
  return [state, update] as const;
}
