import { Briefcase, Copy, Download, Save, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "../api/client";
import { useCloseTabs } from "../layout/close-tabs";
import { usePhone } from "../layout/use-media-query";
import { track } from "../lib/analytics";
import { confirm } from "../lib/confirm";
import { errorMessage } from "../lib/errors";
import { formatDate } from "../lib/format";
import { toast } from "../lib/toast";
import { useTabsStore } from "../tabs/store";
import { useWorkspace } from "../tabs/workspace";
import type { TabViewProps } from "../views/registry";
import { useDeleteLetter, useLetter, useUpdateLetter } from "./queries";

// A cover letter (FEATURE M5): the subject and the text to edit on the left, the page as it
// prints on the right (two panes on phones); copy the text or download the PDF. Unsaved
// edits mark the tab, which asks before closing.

export default function LetterView({ tab }: TabViewProps) {
  const { t, i18n } = useTranslation();
  const { open } = useWorkspace();
  const closeTabs = useCloseTabs();
  const letter = useLetter(tab.id!);
  const update = useUpdateLetter(tab.id!);
  const remove = useDeleteLetter();
  const detail = letter.data;
  const phone = usePhone();
  const [pane, setPane] = useState<"text" | "preview">("text");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  // The letter's text, until the user edits it.
  useEffect(() => {
    if (!detail) return;
    setSubject(detail.subject);
    setBody(detail.body);
  }, [detail?.id, detail?.updatedAt]);
  const dirty = !!detail && (subject !== detail.subject || body !== detail.body);
  useEffect(() => {
    useTabsStore.getState().update(tab.key, { dirty, ...(detail && { title: detail.offer.title }) });
  }, [dirty, tab.key, detail?.offer.title]);

  if (letter.isPending) return <div className="m-8 h-40 animate-pulse rounded-box bg-hover" />;
  if (!detail) {
    const missing = letter.error instanceof ApiError && letter.error.status === 404;
    return <p className="p-10 text-fg-muted">{missing ? t("letter.notFound") : errorMessage(t, letter.error)}</p>;
  }

  const save = () =>
    update.mutate(
      { ...(subject !== detail.subject && { subject }), ...(body !== detail.body && { body }) },
      { onSuccess: () => toast(t("letter.saved")), onError: (error) => toast(errorMessage(t, error), "error") },
    );
  const download = async () => {
    if (dirty && !(await confirm({ title: t("letter.unsavedTitle"), text: t("letter.unsavedPdf"), confirm: t("letter.download") }))) return;
    const link = document.createElement("a");
    link.href = `/api/cover-letters/${detail.id}/pdf`;
    link.click();
    track("letter_pdf");
  };
  const copy = async () => {
    await navigator.clipboard.writeText(`${subject}\n\n${body}`);
    toast(t("letter.copied"));
    track("letter_copy");
  };
  const button = "flex h-8 items-center gap-1.5 rounded-control px-3 text-sm transition-colors";

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
          <span className="truncate text-xs text-fg-muted">{[t("letter.title"), detail.offer.companyName, detail.resume?.name, formatDate(detail.createdAt, i18n.language)].filter(Boolean).join(" · ")}</span>
        </div>
        <button type="button" disabled={!dirty || update.isPending || !subject.trim() || !body.trim()} onClick={save} className={`${button} border border-border hover:bg-hover disabled:opacity-50`}>
          <Save size={15} /> {t("letter.save")}
        </button>
        <button type="button" onClick={() => void copy()} className={`${button} text-fg-muted hover:bg-hover hover:text-fg`}>
          <Copy size={15} /> {t("letter.copy")}
        </button>
        <button type="button" onClick={() => void download()} className={`${button} bg-accent font-medium text-accent-fg hover:bg-accent-hover`}>
          <Download size={15} /> PDF
        </button>
        <button
          type="button"
          aria-label={t("letter.delete")}
          onClick={async () => {
            if (!(await confirm({ title: t("letter.deleteTitle"), text: t("letter.deleteText"), confirm: t("letter.delete"), danger: true }))) return;
            remove.mutate(detail.id, { onSuccess: () => closeTabs([tab.key]), onError: (error) => toast(errorMessage(t, error), "error") });
          }}
          className="flex size-8 items-center justify-center rounded-control text-fg-subtle transition-colors hover:bg-hover hover:text-danger"
        >
          <Trash2 size={15} />
        </button>
      </header>
      {phone && (
        <div role="tablist" className="flex border-b border-border">
          {(["text", "preview"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={pane === value}
              onClick={() => setPane(value)}
              className={`flex-1 py-2 text-sm transition-colors ${pane === value ? "border-b-2 border-accent font-medium text-fg" : "text-fg-muted"}`}
            >
              {t(`letter.panes.${value}`)}
            </button>
          ))}
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <div className={`flex min-h-0 flex-col gap-3 overflow-y-auto border-border p-6 ${phone ? (pane === "text" ? "w-full" : "hidden") : "w-[46%] min-w-80 max-w-[600px] border-r"}`}>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs font-medium text-fg-muted">{t("letter.subject")}</span>
            <input value={subject} onChange={(event) => setSubject(event.target.value)} maxLength={200} className="h-9 rounded-control border border-border bg-bg px-2 outline-none focus:border-accent" />
          </label>
          <label className="flex min-h-0 flex-1 flex-col gap-1 text-sm">
            <span className="text-xs font-medium text-fg-muted">{t("letter.text")}</span>
            <textarea value={body} onChange={(event) => setBody(event.target.value)} maxLength={6000} className="min-h-96 flex-1 resize-none rounded-control border border-border bg-bg px-3 py-2 leading-relaxed outline-none focus:border-accent" />
          </label>
          <p className="text-xs text-fg-subtle">{t("letter.checkHint")}</p>
        </div>
        <div className={`min-w-0 flex-1 bg-hover p-4 ${phone && pane !== "preview" ? "hidden" : ""}`}>
          {/* The saved letter, re-rendered after every save. */}
          <iframe title={t("letter.preview")} src={`/api/cover-letters/${detail.id}/html?v=${encodeURIComponent(detail.updatedAt)}`} sandbox="" className="mx-auto h-full w-full max-w-[860px] rounded-box border border-border bg-white shadow-float" />
        </div>
      </div>
    </div>
  );
}
