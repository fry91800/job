import { keepPreviousData, QueryClient, useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import type { LocationAutocompleteResponse, MeResponse, OfferDetail, OfferSearchResponse, SavedOfferInfo, SavedOfferStatus } from "@job/shared";
import { api } from "./client";

// Data shared by the list and every tab (FRONTEND.md §3): one cache, so a change made in
// one place shows everywhere at once.

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 60_000, refetchOnWindowFocus: false, retry: 1 },
  },
});

export const keys = {
  me: ["me"] as const,
  search: (query: string) => ["search", query] as const,
  offer: (id: string, lang: string) => ["offer", id, lang] as const,
  locations: (q: string) => ["locations", q] as const,
};

export function useMe() {
  return useQuery({ queryKey: keys.me, queryFn: ({ signal }) => api<MeResponse>("GET", "/api/auth/me", { signal }), staleTime: 5 * 60_000 });
}

// Search pages, loaded as the list scrolls. The previous results stay shown (dimmed) while
// a new search loads (FRONTEND.md §5).
export function useOfferSearch(query: string) {
  return useInfiniteQuery({
    queryKey: keys.search(query),
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams(query);
      params.set("page", String(pageParam));
      return api<OfferSearchResponse>("GET", `/api/offers?${params}`, { signal });
    },
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
    placeholderData: keepPreviousData,
  });
}

export const offerQuery = (id: string, lang: string) => ({
  queryKey: keys.offer(id, lang),
  queryFn: ({ signal }: { signal: AbortSignal }) => api<OfferDetail>("GET", `/api/offers/${encodeURIComponent(id)}?lang=${lang}`, { signal }),
});

export function useOffer(id: string, lang: string) {
  return useQuery(offerQuery(id, lang));
}

export function useLocationSuggestions(q: string) {
  return useQuery({
    queryKey: keys.locations(q),
    queryFn: ({ signal }) => api<LocationAutocompleteResponse>("GET", `/api/locations?q=${encodeURIComponent(q)}`, { signal }),
    enabled: q.trim().length >= 2,
    staleTime: 10 * 60_000,
    placeholderData: keepPreviousData,
  });
}

// The saved state of an offer, everywhere it is shown: its detail and the result lists.
function setSavedEverywhere(client: QueryClient, offerId: string, saved: SavedOfferInfo | null) {
  client.setQueriesData<OfferDetail>({ queryKey: ["offer", offerId] }, (offer) => (offer ? { ...offer, saved } : offer));
  client.setQueriesData<InfiniteData<OfferSearchResponse>>({ queryKey: ["search"] }, (data) =>
    data
      ? {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            results: page.results.map((result) => (result.id === offerId ? { ...result, saved: saved ? { status: saved.status } : null } : result)),
          })),
        }
      : data,
  );
}

function savedNow(status: SavedOfferStatus, previous: SavedOfferInfo | null): SavedOfferInfo {
  const now = new Date().toISOString();
  return { notes: null, appliedAt: null, savedAt: now, ...previous, status, statusChangedAt: now };
}

// Save, unsave, change status: shown at once, confirmed by the server, undone on failure
// (FRONTEND.md §3).
export function useSavedOfferMutation(offerId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (change: { status: SavedOfferStatus } | { unsave: true }) => {
      if ("unsave" in change) return api<void>("DELETE", `/api/saved-offers/${offerId}`);
      const saved = await api<SavedOfferInfo>("PUT", `/api/saved-offers/${offerId}`);
      if (change.status === saved.status) return saved;
      return api<SavedOfferInfo>("PATCH", `/api/saved-offers/${offerId}`, { body: { status: change.status } });
    },
    onMutate: async (change) => {
      await client.cancelQueries({ queryKey: ["offer", offerId] });
      const previous = client.getQueriesData<OfferDetail>({ queryKey: ["offer", offerId] })[0]?.[1]?.saved ?? null;
      setSavedEverywhere(client, offerId, "unsave" in change ? null : savedNow(change.status, previous));
      return { previous };
    },
    onError: (_error, _change, context) => setSavedEverywhere(client, offerId, context?.previous ?? null),
    onSuccess: (saved) => {
      if (saved) setSavedEverywhere(client, offerId, saved);
      // The first save creates the guest (FEATURE G1): the session changed.
      void client.invalidateQueries({ queryKey: keys.me });
    },
  });
}
