import type { ModifierConfig, ModifierStrength, Settings, TemplateListResponse } from "@job/shared";
import { HttpError } from "../lib/http-error";
import { prisma } from "../lib/prisma";

// Settings (FEATURE S1, S2).

export async function listTemplates(): Promise<TemplateListResponse> {
  const templates = await prisma.template.findMany({
    where: { deletedAt: null },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    select: { id: true, name: true, rendererKey: true, supportsPhoto: true },
  });
  return { results: templates };
}

// The template to use for this id: itself if still available, else the first available
// one (DATABASE.md "templates").
export async function availableTemplate(templateId: number) {
  const template = await prisma.template.findFirst({ where: { id: templateId, deletedAt: null } });
  if (template) return template;
  const fallback = await prisma.template.findFirst({ where: { deletedAt: null }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] });
  if (!fallback) throw new Error("No template available");
  return fallback;
}

export async function getSettings(userId: string): Promise<Settings> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  return {
    modifierEnabled: user.modifierEnabled,
    modifierStrength: user.modifierStrength as ModifierStrength,
    modifierConfig: user.modifierConfig as ModifierConfig,
    templateId: (await availableTemplate(user.templateId)).id,
    uiLanguage: user.uiLanguage,
  };
}

export async function updateSettings(userId: string, input: Partial<Settings>): Promise<Settings> {
  if (input.templateId !== undefined) {
    const template = await prisma.template.findFirst({ where: { id: input.templateId, deletedAt: null } });
    if (!template) throw new HttpError(400, "unknown_template", "This template does not exist");
  }
  await prisma.user.update({ where: { id: userId }, data: input });
  return getSettings(userId);
}
