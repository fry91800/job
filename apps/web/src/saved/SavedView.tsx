import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ChevronDown, MapPin, NotebookPen, Star, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { SAVED_OFFER_STATUSES, type SavedOfferListItem, type SavedOfferListResponse, type SavedOfferStatus } from "@job/shared";
import { api } from "../api/client";
import { MenuChoice, MenuContent, MenuRoot, MenuTrigger } from "../layout/menu";
import { confirm } from "../lib/confirm";
import { errorMessage } from "../lib/errors";
import { formatDate } from "../lib/format";
import { toast } from "../lib/toast";
import { useWorkspace } from "../tabs/workspace";

// Saved offers and application tracking (FEATURE O3): filter by status, sort, status,
// application date and notes per offer; offers no longer available are flagged.

type Change = { status?: SavedOfferStatus; notes?: string | null; appliedAt?: string | null };

function useSavedMutations() {
  const client = useQueryClient();
  const { t } = useTranslation();
  const refresh = (offerId: string) => {
    void client.invalidateQueries({ queryKey: ["saved-offers"] });
    void client.invalidateQueries({ queryKey: ["offer", offerId] });
    void client.invalidateQueries({ queryKey: ["search"] });
  };
  const update = useMutation({
    mutationFn: ({ offerId, change }: { offerId: string; change: Change }) => api("PATCH", `/api/saved-offers/${offerId}`, { body: change }),
    // Shown at once in every list (FRONTEND.md §3).
    onMutate: ({ offerId, change }) =>
      client.setQueriesData<SavedOfferListResponse>({ queryKey: ["saved-offers"] }, (data) => data && { results: data.results.map((item) => (item.offer.id === offerId ? { ...item, ...change } as SavedOfferListItem : item)) }),
    onError: (error) => toast(errorMessage(t, error), "error"),
    onSettled: (_data, _error, { offerId }) => refresh(offerId),
  });
  const remove = useMutation({
    mutationFn: (offerId: string) => api("DELETE", `/api/saved-offers/${offerId}`),
    onMutate: (offerId) => client.setQueriesData<SavedOfferListResponse>({ queryKey: ["saved-offers"] }, (data) => data && { results: data.results.filter((item) => item.offer.id !== offerId) }),
    onError: (error) => toast(errorMessage(t, error), "error"),
    onSettled: (_data, _error, offerId) => refresh(offerId),
  });
  return { update, remove };
}

// "2026-10-15" ↔ an ISO date at noon UTC (no day shift across time zones).
const dayOf = (iso: string | null) => (iso ? iso.slice(0, 10) : "");
const isoOf = (day: string) => (day ? `${day}T12:00:00.000Z` : null);

function SavedRow({ item }: { item: SavedOfferListItem }) {
  const { t, i18n } = useTranslation();
  const { open } = useWorkspace();
  const { update, remove } = useSavedMutations();
  const [showNotes, setShowNotes] = useState(Boolean(item.notes));
  const [notes, setNotes] = useState(item.notes ?? "");
  useEffect(() => setNotes(item.notes ?? ""), [item.notes]);
  const change = (value: Change) => update.mutate({ offerId: item.offer.id, change: value });
  const offer = item.offer;
  const details = [offer.companyName, offer.location?.name, offer.contractType && t(`offer.contract.${offer.contractType}`)].filter(Boolean);

  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex items-start gap-3">
        <button type="button" onClick={() => open({ kind: "offer", id: offer.id })} className="flex min-w-0 flex-1 flex-col items-start text-left">
          <span className={`truncate font-medium hover:text-accent ${offer.closed ? "text-fg-muted" : ""}`}>{offer.title}</span>
          <span className="flex items-center gap-1 truncate text-xs text-fg-muted">
            {offer.location && <MapPin size={11} className="shrink-0" />}
            {details.join(" · ")}
          </span>
          {offer.closed && (
            <span className="mt-1 flex items-center gap-1 text-xs text-warning">
              <AlertTriangle size={12} /> {t("saved.closed")}
            </span>
          )}
        </button>
        <MenuRoot>
          <MenuTrigger asChild>
            <button
              type="button"
              aria-label={`${t("offer.statusLabel")} : ${t(`offer.status.${item.status}`)}`}
              className="flex h-8 shrink-0 items-center gap-1.5 rounded-control border border-border px-2.5 text-sm transition-colors hover:bg-hover data-[state=open]:bg-hover"
            >
              {t(`offer.status.${item.status}`)} <ChevronDown size={13} className="text-fg-subtle" />
            </button>
          </MenuTrigger>
          <MenuContent align="end">
            <MenuChoice value={item.status} options={SAVED_OFFER_STATUSES.map((status) => ({ value: status, label: t(`offer.status.${status}`) }))} onChange={(status) => change({ status })} />
          </MenuContent>
        </MenuRoot>
        <button
          type="button"
          aria-label={t("saved.notes")}
          aria-pressed={showNotes}
          onClick={() => setShowNotes((value) => !value)}
          className={`flex size-8 shrink-0 items-center justify-center rounded-control transition-colors hover:bg-hover ${item.notes ? "text-accent" : "text-fg-subtle"}`}
        >
          <NotebookPen size={15} />
        </button>
        <button
          type="button"
          aria-label={t("offer.unsave")}
          onClick={async () => {
            // Confirmation when there is something to lose (FEATURE O3).
            if ((item.status !== "saved" || item.notes) && !(await confirm({ title: t("saved.removeTitle"), text: t("saved.removeText"), confirm: t("saved.remove"), danger: true }))) return;
            remove.mutate(offer.id);
          }}
          className="flex size-8 shrink-0 items-center justify-center rounded-control text-fg-subtle transition-colors hover:bg-hover hover:text-danger"
        >
          <Trash2 size={15} />
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-subtle">
        <span>{t("saved.savedOn", { date: formatDate(item.savedAt, i18n.language) })}</span>
        {item.status !== "saved" && <span>{t("saved.changedOn", { date: formatDate(item.statusChangedAt, i18n.language) })}</span>}
        {(item.appliedAt || item.status !== "saved") && (
          <label className="flex items-center gap-1.5">
            {t("saved.appliedOn")}
            <input
              type="date"
              value={dayOf(item.appliedAt)}
              onChange={(event) => change({ appliedAt: isoOf(event.target.value) })}
              className="h-6 rounded-control border border-border bg-bg px-1 text-xs text-fg outline-none focus:border-accent"
            />
          </label>
        )}
      </div>
      {showNotes && (
        <textarea
          value={notes}
          placeholder={t("saved.notesPlaceholder")}
          maxLength={5000}
          aria-label={t("saved.notes")}
          onChange={(event) => setNotes(event.target.value)}
          onBlur={() => notes !== (item.notes ?? "") && change({ notes: notes.trim() || null })}
          className="field-sizing-content min-h-16 w-full resize-y rounded-control border border-border bg-bg px-2.5 py-1.5 text-sm outline-none focus:border-accent"
        />
      )}
    </li>
  );
}

export default function SavedView() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<SavedOfferStatus | null>(null);
  const [sort, setSort] = useState<"saved" | "status_changed">("saved");
  const query = new URLSearchParams({ ...(status && { status }), sort }).toString();
  const saved = useQuery({ queryKey: ["saved-offers", query], queryFn: ({ signal }) => api<SavedOfferListResponse>("GET", `/api/saved-offers?${query}`, { signal }), placeholderData: keepPreviousData });
  const items = saved.data?.results ?? [];
  const chip = (selected: boolean) =>
    `h-7 rounded-full border px-2.5 text-xs transition-colors duration-150 ${selected ? "border-accent bg-accent-soft text-accent" : "border-border text-fg-muted hover:bg-hover hover:text-fg"}`;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 px-8 py-8">
      <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
        <Star size={20} className="text-warning" /> {t("tools.saved")}
      </h1>
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" aria-pressed={status === null} className={chip(status === null)} onClick={() => setStatus(null)}>
          {t("saved.all")}
        </button>
        {SAVED_OFFER_STATUSES.map((value) => (
          <button key={value} type="button" aria-pressed={status === value} className={chip(status === value)} onClick={() => setStatus(value)}>
            {t(`offer.status.${value}`)}
          </button>
        ))}
        <select
          aria-label={t("search.sortLabel")}
          value={sort}
          onChange={(event) => setSort(event.target.value as typeof sort)}
          className="ml-auto h-7 rounded-control bg-transparent text-xs text-fg-muted outline-none hover:text-fg"
        >
          <option value="saved">{t("saved.sortSaved")}</option>
          <option value="status_changed">{t("saved.sortChanged")}</option>
        </select>
      </div>
      {saved.isPending && Array.from({ length: 3 }, (_, index) => <div key={index} className="h-16 animate-pulse rounded-box bg-hover" />)}
      {saved.data && items.length === 0 && <p className="text-fg-muted">{status ? t("saved.emptyStatus") : t("saved.empty")}</p>}
      {items.length > 0 && (
        <ul className={`flex flex-col divide-y divide-border rounded-box border border-border bg-surface transition-opacity ${saved.isPlaceholderData ? "opacity-60" : ""}`}>
          {items.map((item) => (
            <SavedRow key={item.offer.id} item={item} />
          ))}
        </ul>
      )}
    </div>
  );
}
