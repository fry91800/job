import type { ModifierConfig, ModifierStrength, Settings, SettingsResponse, TemplateListResponse } from "@job/shared";
import { config } from "../config";
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

// The sections the AI may rewrite: the strength's (config.modifier), or the user's own
// choice when users choose them (config.modifier.userChoosesSections).
export function modifierSections(strength: ModifierStrength, userChoice: ModifierConfig): ModifierConfig {
  return config.modifier.userChoosesSections ? userChoice : config.modifier.sectionsByStrength[strength];
}

export async function getSettings(userId: string): Promise<SettingsResponse> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const strength = user.modifierStrength as ModifierStrength;
  return {
    modifierEnabled: user.modifierEnabled,
    modifierStrength: strength,
    modifierConfig: modifierSections(strength, user.modifierConfig as ModifierConfig),
    modifierSectionChoice: config.modifier.userChoosesSections,
    modifierSectionsByStrength: config.modifier.sectionsByStrength,
    templateId: (await availableTemplate(user.templateId)).id,
    uiLanguage: user.uiLanguage,
  };
}

// A `modifierConfig` sent while the strength decides is still stored (it applies again if
// users get to choose), but has no effect.
export async function updateSettings(userId: string, input: Partial<Settings>): Promise<SettingsResponse> {
  if (input.templateId !== undefined) {
    const template = await prisma.template.findFirst({ where: { id: input.templateId, deletedAt: null } });
    if (!template) throw new HttpError(400, "unknown_template", "This template does not exist");
  }
  await prisma.user.update({ where: { id: userId }, data: input });
  return getSettings(userId);
}
