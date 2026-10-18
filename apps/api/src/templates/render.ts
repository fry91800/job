import { renderClassic } from "./classic";
import type { TemplateInput } from "./common";
import { renderCompact } from "./compact";
import { renderContemporary } from "./contemporary";
import { renderCreative } from "./creative";
import { renderElegant } from "./elegant";
import { renderExecutive } from "./executive";
import { renderMinimal } from "./minimal";
import { renderModern } from "./modern";

// Template renderers by `templates.renderer_key`. A template row without code here
// cannot be rendered. The rows themselves come from migrations (and the development
// seed); `PHOTO_TEMPLATES` must match their `supports_photo`.
export const renderers: Record<string, (input: TemplateInput) => string> = {
  classic: renderClassic,
  modern: renderModern,
  elegant: renderElegant,
  minimal: renderMinimal,
  contemporary: renderContemporary,
  executive: renderExecutive,
  compact: renderCompact,
  creative: renderCreative,
};

export const PHOTO_TEMPLATES = new Set(["classic", "elegant", "contemporary", "executive", "creative"]);

export function renderResumeHtml(rendererKey: string, input: TemplateInput): string {
  const render = renderers[rendererKey];
  if (!render) throw new Error(`No renderer for template "${rendererKey}"`);
  return render(input);
}
