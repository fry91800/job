import { ArrowLeft, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useWorkspace } from "../tabs/workspace";

// Empty workspace: first visit, or every tab closed (FRONTEND.md §2.2).
export function Welcome() {
  const { t } = useTranslation();
  const { open } = useWorkspace();
  return (
    <div className="animate-fade-in flex h-full items-center justify-center p-8">
      <div className="flex max-w-md flex-col items-start gap-4">
        <span className="flex items-center gap-2 text-sm font-semibold text-accent">
          <img src="/favicon.svg" alt="" className="size-6" /> {t("app.name")}
        </span>
        <h1 className="text-2xl font-semibold tracking-tight">{t("welcome.title")}</h1>
        <p className="leading-relaxed text-fg-muted">{t("welcome.text")}</p>
        <button
          type="button"
          onClick={() => open({ kind: "resumes" })}
          className="mt-2 flex h-9 items-center gap-2 rounded-control bg-accent px-4 text-sm font-medium text-accent-fg transition-colors duration-150 hover:bg-accent-hover"
        >
          <Upload size={16} /> {t("welcome.upload")}
        </button>
        <p className="text-sm text-fg-subtle">{t("welcome.uploadHint")}</p>
        <p className="mt-4 flex items-center gap-2 text-sm text-fg-muted">
          <ArrowLeft size={14} /> {t("welcome.searchHint")}
        </p>
      </div>
    </div>
  );
}
