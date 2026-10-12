import { renderClassic } from "./classic";
import type { TemplateInput } from "./common";
import { renderModern } from "./modern";

// Template renderers by `templates.renderer_key`. A template row without code here
// cannot be rendered.
const renderers: Record<string, (input: TemplateInput) => string> = {
  classic: renderClassic,
  modern: renderModern,
};

export function renderResumeHtml(rendererKey: string, input: TemplateInput): string {
  const render = renderers[rendererKey];
  if (!render) throw new Error(`No renderer for template "${rendererKey}"`);
  return render(input);
}
