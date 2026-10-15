import { useTranslation } from "react-i18next";

// Match % (FEATURE O4): a small neutral-to-green indicator, never an alarm (FRONTEND.md §4).
export function MatchBadge({ score, large = false }: { score: number; large?: boolean }) {
  const { t } = useTranslation();
  const strength = score >= 70 ? "text-success" : score >= 40 ? "text-fg" : "text-fg-subtle";
  return (
    <span title={t("offer.match")} className={`flex shrink-0 items-center gap-1 tabular-nums ${large ? "text-base font-semibold" : "text-xs font-medium"} ${strength}`}>
      <span className={`relative overflow-hidden rounded-full bg-hover ${large ? "h-1.5 w-16" : "h-1 w-6"}`}>
        <span className="absolute inset-y-0 left-0 rounded-full bg-current" style={{ width: `${score}%` }} />
      </span>
      {score}%
    </span>
  );
}
