import { z } from "zod";
import { MODIFIER_SECTIONS, MODIFIER_STRENGTHS, UI_LANGUAGES, type ModifierStrength } from "./constants";

// User settings (FEATURE S1, S2, L1).

export { MODIFIER_SECTIONS, MODIFIER_STRENGTHS, type ModifierStrength } from "./constants";

// Which sections the AI may rewrite (DATABASE.md "modifier_config"). Missing keys = false.
export const modifierConfigSchema = z.strictObject(
  Object.fromEntries(MODIFIER_SECTIONS.map((key) => [key, z.boolean().optional()])) as Record<(typeof MODIFIER_SECTIONS)[number], z.ZodOptional<z.ZodBoolean>>,
);
export type ModifierConfig = z.infer<typeof modifierConfigSchema>;

export const settingsUpdateSchema = z
  .strictObject({
    modifierEnabled: z.boolean(),
    modifierStrength: z.enum(MODIFIER_STRENGTHS),
    modifierConfig: modifierConfigSchema,
    templateId: z.number().int().positive(),
    uiLanguage: z.enum(UI_LANGUAGES),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: "Nothing to update" });

export type Settings = {
  modifierEnabled: boolean;
  modifierStrength: ModifierStrength;
  // The sections the AI may rewrite: those of the strength, or the user's own choice when
  // `modifierSectionChoice` is true (an API configuration).
  modifierConfig: ModifierConfig;
  templateId: number; // falls back to the first available template if the saved one was retired
  uiLanguage: string;
};

// GET /api/settings: the settings and how the sections are decided.
export type SettingsResponse = Settings & {
  modifierSectionChoice: boolean; // false: the strength decides the sections
  modifierSectionsByStrength: Record<ModifierStrength, ModifierConfig>;
};

export type TemplateSummary = { id: number; name: string; rendererKey: string; supportsPhoto: boolean };
export type TemplateListResponse = { results: TemplateSummary[] };
