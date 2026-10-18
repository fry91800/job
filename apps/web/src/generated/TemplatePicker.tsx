import { Camera, Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TemplateSummary } from "@job/shared";

// The resume templates as pictures of their first page (apps/web/public/templates/, made by
// `npm run templates:previews`), for the generate dialog and Settings.

export function useTemplateName() {
  const { t } = useTranslation();
  return (template: Pick<TemplateSummary, "rendererKey" | "name">) => t(`templateNames.${template.rendererKey}`, { defaultValue: template.name });
}

export function TemplatePicker({ templates, value, onChange }: { templates: TemplateSummary[]; value: number | null; onChange: (id: number) => void }) {
  const { t } = useTranslation();
  const name = useTemplateName();
  return (
    <div role="radiogroup" aria-label={t("generate.template")} className="grid grid-cols-3 gap-2.5 sm:grid-cols-4">
      {templates.map((template) => {
        const selected = value === template.id;
        return (
          <button
            key={template.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(template.id)}
            className="group flex flex-col gap-1 text-left"
          >
            <span
              className={`relative block aspect-[210/297] w-full overflow-hidden rounded-control border bg-white transition-all duration-150 ${
                selected ? "border-accent ring-2 ring-accent/40" : "border-border group-hover:border-fg-subtle"
              }`}
            >
              <img src={`/templates/${template.rendererKey}.jpg`} alt="" loading="lazy" className="size-full object-cover object-top" />
              {selected && (
                <span className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-accent text-accent-fg shadow-sm">
                  <Check size={12} strokeWidth={3} />
                </span>
              )}
            </span>
            <span className={`flex items-center gap-1 text-xs ${selected ? "font-semibold text-accent" : "text-fg-muted"}`}>
              {name(template)}
              {template.supportsPhoto && <Camera size={11} className="shrink-0 text-fg-subtle" aria-label={t("generate.withPhoto")} />}
            </span>
          </button>
        );
      })}
    </div>
  );
}
