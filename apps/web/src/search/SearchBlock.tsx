import { Plus, Search, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CONTRACT_TYPES, PUBLISHED_WITHIN, REMOTE_TYPES, SEARCH_RADIUS_CHOICES } from "@job/shared/src/constants";
import { useOfferSearch } from "../api/queries";
import { useWorkspace } from "../tabs/workspace";
import { LocationInput } from "./LocationInput";
import { activeFilterCount, apiQuery, useSearchState, type SearchState } from "./params";

// Search (FRONTEND.md §2.1): keywords and place always visible, searched as you type;
// the other filters behind "Filters".

function Chip({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`h-7 rounded-full border px-2.5 text-xs transition-colors duration-150 ${
        selected ? "border-accent bg-accent-soft text-accent" : "border-border text-fg-muted hover:bg-hover hover:text-fg"
      }`}
    >
      {children}
    </button>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-fg-subtle">{title}</span>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

const toggle = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter((value) => value !== item) : [...list, item]);

function Filters({ state, update }: { state: SearchState; update: (change: Partial<SearchState>) => void }) {
  const { t } = useTranslation();
  const [salary, setSalary] = useState(state.salaryMin?.toString() ?? "");
  useEffect(() => setSalary(state.salaryMin?.toString() ?? ""), [state.salaryMin]);
  const select = "h-7 rounded-control border border-border bg-surface px-1.5 text-xs text-fg outline-none focus:border-accent";
  return (
    <div className="animate-fade-in flex flex-col gap-3 pt-1">
      {state.locationId !== null && (
        <div className="flex flex-wrap items-center gap-3 text-xs text-fg-muted">
          <label className="flex items-center gap-1.5">
            {t("search.radius")}
            <select aria-label={t("search.radius")} className={select} value={state.radius} onChange={(event) => update({ radius: Number(event.target.value) })}>
              {SEARCH_RADIUS_CHOICES.map((km) => (
                <option key={km} value={km}>
                  {km === 0 ? t("search.exactPlace") : t("search.radiusValue", { km })}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" className="accent-[var(--accent)]" checked={state.includeRemote} onChange={(event) => update({ includeRemote: event.target.checked })} />
            {t("search.includeRemote")}
          </label>
        </div>
      )}
      <Section title={t("search.contract")}>
        {CONTRACT_TYPES.filter((type) => type !== "other").map((type) => (
          <Chip key={type} selected={state.contractType.includes(type)} onClick={() => update({ contractType: toggle(state.contractType, type) })}>
            {t(`offer.contract.${type}`)}
          </Chip>
        ))}
      </Section>
      <Section title={t("search.remote")}>
        {REMOTE_TYPES.map((type) => (
          <Chip key={type} selected={state.remoteType.includes(type)} onClick={() => update({ remoteType: toggle(state.remoteType, type) })}>
            {t(`offer.remote.${type}`)}
          </Chip>
        ))}
      </Section>
      <Section title={t("search.published")}>
        <Chip selected={state.publishedWithin === null} onClick={() => update({ publishedWithin: null })}>
          {t("search.publishedWithin.any")}
        </Chip>
        {PUBLISHED_WITHIN.map((value) => (
          <Chip key={value} selected={state.publishedWithin === value} onClick={() => update({ publishedWithin: value })}>
            {t(`search.publishedWithin.${value}`)}
          </Chip>
        ))}
      </Section>
      <div className="flex flex-wrap items-center gap-3 text-xs text-fg-muted">
        <label className="flex items-center gap-1.5">
          {t("search.salaryMin")}
          <input
            inputMode="numeric"
            className={`${select} w-20 tabular-nums`}
            value={salary}
            onChange={(event) => setSalary(event.target.value.replace(/\D/g, ""))}
            onBlur={() => update({ salaryMin: salary ? Number(salary) : null })}
            onKeyDown={(event) => event.key === "Enter" && update({ salaryMin: salary ? Number(salary) : null })}
          />
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" className="accent-[var(--accent)]" checked={state.salaryShownOnly} onChange={(event) => update({ salaryShownOnly: event.target.checked })} />
          {t("search.salaryShownOnly")}
        </label>
      </div>
      {activeFilterCount(state) > 0 && (
        <button
          type="button"
          onClick={() => update({ contractType: [], remoteType: [], publishedWithin: null, salaryMin: null, salaryShownOnly: false })}
          className="flex items-center gap-1 self-start text-xs text-fg-muted transition-colors hover:text-fg"
        >
          <X size={12} /> {t("search.clearFilters")}
        </button>
      )}
    </div>
  );
}

export function SearchBlock() {
  const { t } = useTranslation();
  const { open } = useWorkspace();
  const [state, update] = useSearchState();
  const [showFilters, setShowFilters] = useState(false);
  const [keywords, setKeywords] = useState(state.q);
  const keywordsRef = useRef<HTMLInputElement>(null);
  const search = useOfferSearch(apiQuery(state));
  const total = search.data?.pages[0]?.total;
  const filterCount = activeFilterCount(state);

  // Searched as you type, once typing pauses (FRONTEND.md §5).
  useEffect(() => {
    if (keywords.trim() === state.q) return;
    const timer = setTimeout(() => update({ q: keywords }), 250);
    return () => clearTimeout(timer);
  }, [keywords, state.q, update]);
  // The address changed (back button, link): show its keywords.
  useEffect(() => {
    if (document.activeElement !== keywordsRef.current) setKeywords(state.q);
  }, [state.q]);

  return (
    <div className="flex flex-col gap-2 border-b border-border p-3">
      <label className="flex h-9 items-center gap-2 rounded-control border border-border bg-surface px-2.5 transition-colors duration-150 focus-within:border-accent">
        <Search size={16} className="shrink-0 text-fg-subtle" />
        <input
          ref={keywordsRef}
          type="search"
          className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-fg-subtle [&::-webkit-search-cancel-button]:hidden"
          placeholder={t("search.keywords")}
          aria-label={t("search.keywords")}
          value={keywords}
          onChange={(event) => setKeywords(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && update({ q: keywords })}
        />
        {keywords && (
          <button
            type="button"
            aria-label={t("search.clearKeywords")}
            onClick={() => {
              setKeywords("");
              update({ q: "" });
            }}
            className="flex size-5 shrink-0 items-center justify-center rounded-control text-fg-subtle transition-colors hover:bg-hover hover:text-fg"
          >
            <X size={14} />
          </button>
        )}
      </label>
      <LocationInput
        value={state.locationId !== null ? { id: state.locationId, name: state.locationName ?? "" } : null}
        onChange={(place) => update(place ? { locationId: place.id, locationName: place.name } : { locationId: null, locationName: null })}
      />
      <div className="flex items-center justify-between">
        <button
          type="button"
          aria-expanded={showFilters}
          onClick={() => setShowFilters((value) => !value)}
          className={`relative flex h-7 items-center gap-1.5 rounded-control px-2 text-sm transition-colors hover:bg-hover hover:text-fg ${showFilters ? "text-fg" : "text-fg-muted"}`}
        >
          <SlidersHorizontal size={14} /> {t("search.filters")}
          {filterCount > 0 && <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-accent-fg">{filterCount}</span>}
        </button>
        <button type="button" onClick={() => open({ kind: "add-offer" })} className="flex h-7 items-center gap-1.5 rounded-control px-2 text-sm text-fg-muted transition-colors hover:bg-hover hover:text-fg">
          <Plus size={14} /> {t("search.addOffer")}
        </button>
      </div>
      {showFilters && <Filters state={state} update={update} />}
      <div className="flex h-6 items-center justify-between text-xs text-fg-subtle">
        <span className="tabular-nums">{total !== undefined ? t("search.results", { count: total }) : " "}</span>
        <select
          aria-label={t("search.sortLabel")}
          value={state.sort}
          onChange={(event) => update({ sort: event.target.value as SearchState["sort"] })}
          className="cursor-pointer rounded-control bg-transparent text-xs text-fg-muted outline-none hover:text-fg"
        >
          <option value="relevance">{t("search.sort.relevance")}</option>
          <option value="recent">{t("search.sort.recent")}</option>
        </select>
      </div>
    </div>
  );
}
