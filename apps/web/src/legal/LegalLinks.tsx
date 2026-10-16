import { useTranslation } from "react-i18next";
import { useWorkspace } from "../tabs/workspace";

// Links to the privacy policy and the terms, opened as workspace tabs.
export function LegalLinks({ className = "" }: { className?: string }) {
  const { t } = useTranslation();
  const { open } = useWorkspace();
  return (
    <p className={`flex gap-3 text-xs text-fg-subtle ${className}`}>
      {(["privacy", "terms"] as const).map((kind) => (
        <a
          key={kind}
          href={`/${kind}`}
          onClick={(event) => {
            event.preventDefault();
            open({ kind });
          }}
          className="hover:text-fg hover:underline"
        >
          {t(`tabs.kinds.${kind}`)}
        </a>
      ))}
    </p>
  );
}
