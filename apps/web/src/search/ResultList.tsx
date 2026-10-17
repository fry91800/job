import { useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Star } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { OfferSearchResult } from "@job/shared";
import { computeMatch } from "@job/shared/src/match";
import { offerQuery, useMe, useOfferSearch } from "../api/queries";
import { track } from "../lib/analytics";
import { formatAge } from "../lib/format";
import { MatchBadge } from "../offers/MatchBadge";
import { useTabsStore } from "../tabs/store";
import { useWorkspace } from "../tabs/workspace";
import { apiQuery, useSearchState } from "./params";

// Results (FRONTEND.md §2.1): only the visible rows are rendered, more load while
// scrolling; a click shows the offer in the preview tab, a double-click keeps it open;
// resting the pointer on a row loads the offer beforehand (FRONTEND.md §5).

const ROW_HEIGHT = 60;

function ResultRow({ offer, active, score }: { offer: OfferSearchResult; active: boolean; score: number | null }) {
  const { t, i18n } = useTranslation();
  const { open } = useWorkspace();
  const client = useQueryClient();
  const prefetchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const details = [
    offer.companyName,
    offer.locationMatch === "remote" ? t("search.remoteMatch") : offer.location?.name,
    offer.contractType ? t(`offer.contract.${offer.contractType}`) : null,
    formatAge(offer.publishedAt, i18n.language),
  ].filter(Boolean);
  return (
    <button
      type="button"
      onClick={() => open({ kind: "offer", id: offer.id }, { preview: true })}
      onDoubleClick={() => open({ kind: "offer", id: offer.id })}
      onPointerEnter={() => {
        prefetchTimer.current = setTimeout(() => void client.prefetchQuery(offerQuery(offer.id, i18n.language)), 120);
      }}
      onPointerLeave={() => clearTimeout(prefetchTimer.current)}
      onFocus={() => void client.prefetchQuery(offerQuery(offer.id, i18n.language))}
      className={`flex h-full w-full flex-col justify-center gap-0.5 border-l-2 px-3 text-left transition-colors duration-100 ${
        active ? "border-accent bg-selected" : "border-transparent hover:bg-hover"
      }`}
    >
      <span className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-medium">{offer.title}</span>
        {score !== null && <MatchBadge score={score} />}
      </span>
      <span className="flex items-center gap-1.5 text-xs text-fg-muted">
        <span className="min-w-0 flex-1 truncate">{details.join(" · ")}</span>
        {offer.locationMatch === "wider_area" && <span className="shrink-0 rounded-sm bg-hover px-1 text-[10px]">{t("search.wholeArea")}</span>}
        {offer.saved && <Star size={12} className="shrink-0 fill-warning text-warning" aria-label={t("offer.saved")} />}
      </span>
    </button>
  );
}

function SkeletonRows() {
  return (
    <div aria-hidden>
      {Array.from({ length: 8 }, (_, index) => (
        <div key={index} className="flex flex-col justify-center gap-2 px-3" style={{ height: ROW_HEIGHT }}>
          <div className="h-3.5 w-3/4 animate-pulse rounded-sm bg-hover" />
          <div className="h-3 w-1/2 animate-pulse rounded-sm bg-hover" />
        </div>
      ))}
    </div>
  );
}

export function ResultList() {
  const { t } = useTranslation();
  const [state] = useSearchState();
  const query = apiQuery(state);
  const search = useOfferSearch(query);
  const resume = useMe().data?.user?.selectedResume ?? null;
  const activeKey = useTabsStore((store) => store.activeKey);
  const scrollRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => search.data?.pages.flatMap((page) => page.results) ?? [], [search.data]);
  const virtualizer = useVirtualizer({
    count: rows.length + (search.hasNextPage ? 1 : 0),
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });
  const items = virtualizer.getVirtualItems();

  // Searches people make (GROWTH.md §5): once per search, with its words and result count.
  const tracked = useRef<string | null>(null);
  const firstPage = search.isPlaceholderData ? undefined : search.data?.pages[0];
  useEffect(() => {
    if (!firstPage || !query || tracked.current === query) return;
    tracked.current = query;
    const params = new URLSearchParams(query);
    track("search", { q: (params.get("q") ?? "").slice(0, 60), location: params.has("locationId"), results: firstPage.total });
  }, [firstPage, query]);

  // A new search starts at the top.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [query]);

  // The loader row came into view: next page.
  const lastIndex = items.at(-1)?.index ?? -1;
  useEffect(() => {
    if (lastIndex >= rows.length - 1 && search.hasNextPage && !search.isFetchingNextPage) void search.fetchNextPage();
  }, [lastIndex, rows.length, search]);

  if (search.isPending) return <SkeletonRows />;
  if (search.isError && !search.data) {
    return (
      <div className="flex flex-col items-center gap-2 p-6 text-center text-sm text-fg-muted">
        {t("search.error")}
        <button type="button" onClick={() => void search.refetch()} className="text-accent hover:underline">
          {t("search.retry")}
        </button>
      </div>
    );
  }
  if (rows.length === 0) return <p className="p-6 text-center text-sm text-fg-subtle">{t("search.empty")}</p>;

  return (
    <div ref={scrollRef} className={`min-h-0 flex-1 overflow-y-auto transition-opacity duration-150 ${search.isPlaceholderData ? "opacity-50" : ""}`}>
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {items.map((item) => {
          const offer = rows[item.index];
          return (
            <div key={item.key} className="absolute inset-x-0 border-b border-border" style={{ top: item.start, height: item.size }}>
              {offer ? (
                <ResultRow offer={offer} active={activeKey === `offer:${offer.id}`} score={resume ? computeMatch(offer, resume).score : null} />
              ) : (
                <div className="flex h-full flex-col justify-center gap-2 px-3" aria-hidden>
                  <div className="h-3.5 w-2/3 animate-pulse rounded-sm bg-hover" />
                  <div className="h-3 w-1/3 animate-pulse rounded-sm bg-hover" />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
