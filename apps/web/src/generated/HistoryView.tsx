import { Mail, Sparkles, SquareSparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatDate } from "../lib/format";
import { MatchBadge } from "../offers/MatchBadge";
import { useLetters } from "../letters/queries";
import { useWorkspace } from "../tabs/workspace";
import { useGeneratedList } from "./queries";

// Generated resumes history, newest first (FEATURE M3), then the cover letters (M5): a click
// opens the resume or the letter.
export default function HistoryView() {
  const { t, i18n } = useTranslation();
  const { open } = useWorkspace();
  const list = useGeneratedList();
  const items = list.data?.results ?? [];
  const letters = useLetters().data?.results ?? [];
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6 sm:px-8 sm:py-8">
      <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
        <SquareSparkles size={20} className="text-accent" /> {t("tools.history")}
      </h1>
      {list.isPending && Array.from({ length: 3 }, (_, index) => <div key={index} className="h-14 animate-pulse rounded-box bg-hover" />)}
      {list.data && items.length === 0 && <p className="text-fg-muted">{t("review.historyEmpty")}</p>}
      <ul className="flex flex-col divide-y divide-border rounded-box border border-border bg-surface">
        {items.map((item) => (
          <li key={item.id}>
            <button type="button" onClick={() => open({ kind: "generated", id: item.id })} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-hover">
              <Sparkles size={16} className={item.modified ? "shrink-0 text-accent" : "shrink-0 text-fg-subtle"} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-medium">{item.offer.title}</span>
                <span className="truncate text-xs text-fg-muted">
                  {[item.offer.companyName, formatDate(item.createdAt, i18n.language), item.template.name, item.modifierStrength ? t(`generate.strengths.${item.modifierStrength}`) : t("review.unmodified")]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              {item.pendingChanges > 0 && <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">{t("review.pendingBadge", { count: item.pendingChanges })}</span>}
              {item.matchScore !== null && <MatchBadge score={item.matchScore} />}
            </button>
          </li>
        ))}
      </ul>
      {letters.length > 0 && (
        <>
          <h2 className="mt-4 flex items-center gap-2 text-base font-semibold">
            <Mail size={17} className="text-accent" /> {t("letter.history")}
          </h2>
          <ul className="flex flex-col divide-y divide-border rounded-box border border-border bg-surface">
            {letters.map((letter) => (
              <li key={letter.id}>
                <button type="button" onClick={() => open({ kind: "letter", id: letter.id })} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-hover">
                  <Mail size={16} className="shrink-0 text-accent" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-medium">{letter.offer.title}</span>
                    <span className="truncate text-xs text-fg-muted">{[letter.offer.companyName, formatDate(letter.createdAt, i18n.language), letter.language.toUpperCase()].filter(Boolean).join(" · ")}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
