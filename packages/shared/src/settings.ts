import { z } from "zod";
import { UI_LANGUAGES } from "./auth";

// User settings (FEATURE S1, S2, L1).

export const MODIFIER_STRENGTHS = ["soft", "medium", "hard"] as const;
export type ModifierStrength = (typeof MODIFIER_STRENGTHS)[number];

// Which sections the AI may rewrite (DATABASE.md "modifier_config"). Missing keys = false.
export const MODIFIER_SECTIONS = ["summary", "title", "skills", "workExperience", "projects"] as const;
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
  modifierConfig: ModifierConfig;
  templateId: number; // falls back to the first available template if the saved one was retired
  uiLanguage: string;
};

export type TemplateSummary = { id: number; name: string; rendererKey: string; supportsPhoto: boolean };
export type TemplateListResponse = { results: TemplateSummary[] };
