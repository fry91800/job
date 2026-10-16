import { ScrollText, Shield } from "lucide-react";
import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import { renderInline } from "../offers/Markdown";
import { parseMarkdown } from "../offers/markdown-parse";
import type { TabViewProps } from "../views/registry";
import { LEGAL_TEXTS, type LegalPage } from "./texts";

// Privacy policy and terms (tabs "privacy" and "terms"), in the interface language.
export default function LegalView({ tab }: TabViewProps) {
  const { t, i18n } = useTranslation();
  const page = tab.kind as LegalPage;
  const text = LEGAL_TEXTS[i18n.language === "en" ? "en" : "fr"][page];
  const Icon = page === "privacy" ? Shield : ScrollText;
  return (
    <article className="mx-auto flex max-w-2xl flex-col gap-3 px-4 py-6 text-[15px] leading-relaxed sm:px-8 sm:py-8">
      <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
        <Icon size={20} className="text-accent" /> {t(`tabs.kinds.${page}`)}
      </h1>
      {parseMarkdown(text).map((block, index) => {
        if (block.type === "heading") return <h2 key={index} className="mt-3 text-base font-semibold">{renderInline(block.text)}</h2>;
        if (block.type === "list")
          return (
            <ul key={index} className="flex list-disc flex-col gap-1 pl-5 marker:text-fg-subtle">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{renderInline(item)}</li>
              ))}
            </ul>
          );
        return (
          <p key={index} className={index === 0 ? "text-sm text-fg-muted" : ""}>
            {block.lines.map((line, lineIndex) => (
              <Fragment key={lineIndex}>
                {lineIndex > 0 && <br />}
                {renderInline(line)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </article>
  );
}
