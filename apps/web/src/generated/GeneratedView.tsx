import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowDownUp, Briefcase, Check, ChevronDown, ChevronUp, Download, Minus, Plus, Trash2, Undo2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { GeneratedResumeDetail, PhotoListResponse, ResumeChange } from "@job/shared";
import { ApiError, api } from "../api/client";
import { useCloseTabs } from "../layout/close-tabs";
import { usePhone } from "../layout/use-media-query";
import { confirm } from "../lib/confirm";
import { diffWords } from "../lib/diff";
import { errorMessage } from "../lib/errors";
import { formatDate } from "../lib/format";
import { toast } from "../lib/toast";
import { MatchBadge } from "../offers/MatchBadge";
import { useTabsStore } from "../tabs/store";
import { useWorkspace } from "../tabs/workspace";
import { track } from "../lib/analytics";
import type { TabViewProps } from "../views/registry";
import { changeContext, fieldOf, namesInOrder, sectionOf, valueText, type Section } from "./change-labels";
import { useDecide, useDeleteGenerated, useGenerated, useTemplates, useUpdateGenerated } from "./queries";
import { useTemplateName } from "./TemplatePicker";

// A generated resume (FEATURE M3, M4): the AI's changes to review, one by one or all at
// once (pending counts as accepted until reviewed), beside the rendered preview; template
// and photo changed without a new generation; PDF download.

const SECTION_ORDER: Section[] = ["basics", "summary", "skills", "workExperience", "projects", "other"];

function Diff({ before, after }: { before: string; after: string }) {
  return (
    <p className="whitespace-pre-line text-sm leading-relaxed">
      {diffWords(before, after).map((part, index) =>
        part.type === "same" ? (
          <span key={index}>{part.text}</span>
        ) : part.type === "removed" ? (
          <del key={index} className="rounded-sm bg-diff-del-bg text-diff-del-fg">
            {part.text}
          </del>
        ) : (
          <ins key={index} className="rounded-sm bg-diff-add-bg text-diff-add-fg no-underline">
            {part.text}
          </ins>
        ),
      )}
    </p>
  );
}

function ChangeCard({ change, detail, focused, onDecide }: { change: ResumeChange; detail: GeneratedResumeDetail; focused: boolean; onDecide: (status: "accepted" | "rejected") => void }) {
  const { t } = useTranslation();
  const context = changeContext(change, detail.originalContent, detail.generatedContent);
  const field = fieldOf(change);
  const tone =
    change.status === "rejected" ? "border-l-danger/60 opacity-70" : change.status === "accepted" ? "border-l-success" : change.status === "edited" ? "border-l-fg-subtle" : "border-l-accent";
  const button = "flex h-7 items-center gap-1 rounded-control px-2 text-xs font-medium transition-colors duration-150";
  return (
    <div data-change={change.id} className={`flex flex-col gap-2 rounded-box border border-l-4 border-border bg-surface p-3 transition-shadow ${tone} ${focused ? "ring-2 ring-accent/50" : ""}`}>
      <div className="flex items-center gap-2 text-xs text-fg-muted">
        {change.op === "add" ? <Plus size={13} className="text-success" /> : change.op === "remove" ? <Minus size={13} className="text-danger" /> : change.op === "reorder" ? <ArrowDownUp size={13} /> : null}
        <span className="truncate">{[context, t(`review.fields.${field}`)].filter(Boolean).join(" · ")}</span>
        {change.status === "pending" && <span className="ml-auto shrink-0 rounded-full bg-accent-soft px-1.5 text-[10px] font-medium text-accent">{t("review.toReview")}</span>}
      </div>
      {change.op === "replace" && <Diff before={valueText(change.before)} after={valueText(change.after)} />}
      {change.op === "add" && <p className="text-sm text-success">+ {valueText(change.after)}</p>}
      {change.op === "remove" && <p className="text-sm text-danger line-through">{valueText(change.before)}</p>}
      {change.op === "reorder" && (
        <div className="flex flex-col gap-1 text-xs">
          <span className="text-fg-subtle line-through">{namesInOrder(change, change.before, detail.originalContent).join(" · ")}</span>
          <span>{namesInOrder(change, change.after, detail.originalContent).join(" · ")}</span>
        </div>
      )}
      {change.flag === "added_skill" && (
        <p className="flex items-center gap-1.5 text-xs text-warning">
          <AlertTriangle size={13} /> {t("review.addedSkill")}
        </p>
      )}
      {change.status === "edited" ? (
        <p className="text-xs text-fg-subtle">{t("review.edited")}</p>
      ) : (
        <div className="flex gap-1.5">
          <button
            type="button"
            aria-pressed={change.status === "accepted"}
            onClick={() => onDecide("accepted")}
            className={`${button} ${change.status === "accepted" ? "bg-success/15 text-success" : "text-fg-muted hover:bg-hover hover:text-fg"}`}
          >
            <Check size={13} /> {t("review.accept")}
          </button>
          <button
            type="button"
            aria-pressed={change.status === "rejected"}
            onClick={() => onDecide("rejected")}
            className={`${button} ${change.status === "rejected" ? "bg-danger/15 text-danger" : "text-fg-muted hover:bg-hover hover:text-fg"}`}
          >
            {change.status === "rejected" ? <Undo2 size={13} /> : <X size={13} />} {change.status === "rejected" ? t("review.rejected") : t("review.reject")}
          </button>
        </div>
      )}
    </div>
  );
}

function Review({ detail }: { detail: GeneratedResumeDetail }) {
  const { t } = useTranslation();
  const decide = useDecide(detail.id);
  const list = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const changes = detail.changes;
  const reviewed = changes.filter((change) => change.status !== "pending").length;
  const bySection = useMemo(
    () => SECTION_ORDER.map((section) => ({ section, changes: changes.filter((change) => sectionOf(change) === section) })).filter((group) => group.changes.length),
    [changes],
  );
  const send = (items: ResumeChange[], status: "accepted" | "rejected") => {
    const decisions = items.filter((change) => change.status !== "edited" && change.status !== status).map((change) => ({ id: change.id, status }));
    if (decisions.length) decide.mutate(decisions, { onError: (error) => toast(errorMessage(t, error), "error") });
  };
  // Next / previous change still to review (FEATURE M4).
  const go = (by: 1 | -1) => {
    const pending = changes.filter((change) => change.status === "pending");
    if (!pending.length) return;
    const index = pending.findIndex((change) => change.id === focused);
    const next = pending[(index + by + pending.length) % pending.length] ?? pending[0];
    setFocused(next.id);
    list.current?.querySelector(`[data-change="${next.id}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  };

  if (!detail.modified) return <p className="p-6 text-sm text-fg-muted">{t("review.notModified")}</p>;
  if (changes.length === 0) return <p className="p-6 text-sm text-fg-muted">{t("review.none")}</p>;

  const small = "flex h-7 items-center gap-1 rounded-control px-2 text-xs text-fg-muted transition-colors hover:bg-hover hover:text-fg";
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-1 border-b border-border px-4 py-2">
        <span className="mr-auto text-sm tabular-nums">
          {t("review.progress", { reviewed, total: changes.length })}
        </span>
        <button type="button" className={small} onClick={() => go(-1)} aria-label={t("review.previous")}>
          <ChevronUp size={14} />
        </button>
        <button type="button" className={small} onClick={() => go(1)} aria-label={t("review.next")}>
          <ChevronDown size={14} />
        </button>
        <button type="button" className={small} onClick={() => send(changes, "accepted")}>
          <Check size={13} /> {t("review.acceptAll")}
        </button>
        <button type="button" className={small} onClick={() => send(changes, "rejected")}>
          <X size={13} /> {t("review.rejectAll")}
        </button>
      </div>
      <div ref={list} className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4">
        {bySection.map((group) => (
          <section key={group.section} className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <h2 className="mr-auto text-xs font-semibold uppercase tracking-wide text-fg-subtle">{t(`review.sections.${group.section}`)}</h2>
              <button type="button" className="text-xs text-fg-muted hover:text-success" onClick={() => send(group.changes, "accepted")}>
                {t("review.acceptSection")}
              </button>
              <button type="button" className="text-xs text-fg-muted hover:text-danger" onClick={() => send(group.changes, "rejected")}>
                {t("review.rejectSection")}
              </button>
            </div>
            {group.changes.map((change) => (
              <ChangeCard
                key={change.id}
                change={change}
                detail={detail}
                focused={focused === change.id}
                onDecide={(status) => {
                  setFocused(change.id);
                  send([change], status);
                }}
              />
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}

export default function GeneratedView({ tab }: TabViewProps) {
  const { t, i18n } = useTranslation();
  const { open } = useWorkspace();
  const closeTabs = useCloseTabs();
  const generated = useGenerated(tab.id!);
  const templates = useTemplates();
  const templateName = useTemplateName();
  const photos = useQuery({ queryKey: ["photos"], queryFn: ({ signal }) => api<PhotoListResponse>("GET", "/api/photos", { signal }) });
  const update = useUpdateGenerated(tab.id!);
  const remove = useDeleteGenerated();
  const detail = generated.data;
  // Phones show the changes or the preview (FRONTEND.md §2.5).
  const phone = usePhone();
  const [phonePane, setPhonePane] = useState<"changes" | "preview">("changes");

  useEffect(() => {
    if (detail) useTabsStore.getState().update(tab.key, { title: detail.offer.title });
  }, [detail?.offer.title, tab.key, detail]);

  if (generated.isPending) return <div className="m-8 h-40 animate-pulse rounded-box bg-hover" />;
  if (!detail) {
    const missing = generated.error instanceof ApiError && generated.error.status === 404;
    return <p className="p-10 text-fg-muted">{missing ? t("review.notFound") : errorMessage(t, generated.error)}</p>;
  }

  const template = templates.data?.results.find((item) => item.id === detail.template.id);
  const pending = detail.changes.filter((change) => change.status === "pending").length;
  const select = "h-8 rounded-control border border-border bg-bg px-2 text-sm outline-none focus:border-accent";

  const download = async () => {
    if (pending > 0 && !(await confirm({ title: t("review.pdfPendingTitle"), text: t("review.pdfPending", { count: pending }), confirm: t("review.download") }))) return;
    const link = document.createElement("a");
    link.href = `/api/generated-resumes/${detail.id}/pdf`;
    link.click();
    track("pdf_download");
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-6 py-3">
        <div className="mr-auto flex min-w-0 flex-col">
          <h1 className="min-w-0">
            <button type="button" onClick={() => open({ kind: "offer", id: detail.offer.id })} className="flex min-w-0 max-w-full items-center gap-1.5 text-left font-semibold hover:text-accent">
              <Briefcase size={15} className="shrink-0 text-fg-subtle" />
              <span className="truncate">{detail.offer.title}</span>
            </button>
          </h1>
          <span className="truncate text-xs text-fg-muted">
            {[detail.offer.companyName, detail.resume?.name, formatDate(detail.createdAt, i18n.language), detail.modifierStrength && t(`generate.strengths.${detail.modifierStrength}`)].filter(Boolean).join(" · ")}
          </span>
        </div>
        {detail.matchScore !== null && <MatchBadge score={detail.matchScore} />}
        <select aria-label={t("generate.template")} className={select} value={detail.template.id} onChange={(event) => update.mutate({ templateId: Number(event.target.value) })}>
          {templates.data?.results.map((item) => (
            <option key={item.id} value={item.id}>
              {templateName(item)}
            </option>
          ))}
        </select>
        {template?.supportsPhoto && (
          <select aria-label={t("photos.resumePhoto")} className={select} value={detail.photoId ?? ""} onChange={(event) => update.mutate({ photoId: event.target.value || null })}>
            <option value="">{t("photos.none")}</option>
            {photos.data?.results.map((photo) => (
              <option key={photo.id} value={photo.id}>
                {photo.name}
              </option>
            ))}
          </select>
        )}
        <button type="button" onClick={() => void download()} className="flex h-8 items-center gap-1.5 rounded-control bg-accent px-3 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover">
          <Download size={15} /> PDF
        </button>
        <button
          type="button"
          aria-label={t("review.delete")}
          onClick={async () => {
            if (!(await confirm({ title: t("review.deleteTitle"), text: t("review.deleteText"), confirm: t("review.delete"), danger: true }))) return;
            remove.mutate(detail.id, { onSuccess: () => closeTabs([tab.key]), onError: (error) => toast(errorMessage(t, error), "error") });
          }}
          className="flex size-8 items-center justify-center rounded-control text-fg-subtle transition-colors hover:bg-hover hover:text-danger"
        >
          <Trash2 size={15} />
        </button>
      </header>
      {phone && (
        <div role="tablist" className="flex border-b border-border">
          {(["changes", "preview"] as const).map((pane) => (
            <button
              key={pane}
              type="button"
              role="tab"
              aria-selected={phonePane === pane}
              onClick={() => setPhonePane(pane)}
              className={`flex-1 py-2 text-sm transition-colors ${phonePane === pane ? "border-b-2 border-accent font-medium text-fg" : "text-fg-muted"}`}
            >
              {t(`review.panes.${pane}`)}
            </button>
          ))}
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <div className={`flex flex-col border-border ${phone ? (phonePane === "changes" ? "w-full" : "hidden") : "w-[44%] min-w-80 max-w-[560px] border-r"}`}>
          <Review detail={detail} />
        </div>
        <div className={`min-w-0 flex-1 bg-hover p-4 ${phone && phonePane !== "preview" ? "hidden" : ""}`}>
          {/* Re-rendered after every change (address changes with the last update). */}
          <iframe
            title={t("review.preview")}
            src={`/api/generated-resumes/${detail.id}/html?v=${encodeURIComponent(detail.updatedAt)}`}
            sandbox=""
            className="mx-auto h-full w-full max-w-[860px] rounded-box border border-border bg-white shadow-float"
          />
        </div>
      </div>
    </div>
  );
}
