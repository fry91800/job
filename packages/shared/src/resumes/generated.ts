import { z } from "zod";
import { MODIFIER_STRENGTHS, modifierConfigSchema } from "../settings";
import type { ResumeChange } from "./changes";
import { resumeContentSchema, type ResumeContent } from "./content";

// Generated resumes (FEATURE M1, M3).

export const generateResumeSchema = z.strictObject({
  offerId: z.uuid(),
  resumeId: z.uuid().optional(), // defaults to the selected resume
  templateId: z.number().int().positive().optional(), // defaults to the user's template
  modifierEnabled: z.boolean().optional(), // defaults to the user's setting
  // One-off overrides of the modifier settings (M1); saved as the new defaults if `remember`.
  modifierStrength: z.enum(MODIFIER_STRENGTHS).optional(),
  modifierConfig: modifierConfigSchema.optional(),
  remember: z.boolean().optional(),
  // Generate even though the offer is in another language than the resume (M1).
  ignoreLanguageMismatch: z.boolean().optional(),
});

export const generatedResumeUpdateSchema = z
  .strictObject({
    templateId: z.number().int().positive(),
    photoId: z.uuid().nullable(), // null = no photo
    generatedContent: resumeContentSchema,
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: "Nothing to update" });

export const generatedResumeListSchema = z.object({ offerId: z.uuid().optional() });

// Details of the 409 `language_mismatch` error (M1 language check).
export type LanguageMismatchDetails = {
  offerLanguage: string;
  resumeLanguage: string;
  // A resume of the user in the offer's language, proposed as the source instead.
  alternativeResumeId: string | null;
};

export type GeneratedResumeListItem = {
  id: string;
  offer: { id: string; title: string; companyName: string | null };
  resume: { id: string; name: string } | null; // null once the source resume is purged
  language: string;
  template: { id: number; name: string };
  modified: boolean; // false = modifier off, the original rendered with the template
  modifierStrength: string | null;
  matchScore: number | null;
  pendingChanges: number;
  createdAt: string;
};

export type GeneratedResumeListResponse = { results: GeneratedResumeListItem[] };

export type GeneratedResumeDetail = GeneratedResumeListItem & {
  originalContent: ResumeContent;
  generatedContent: ResumeContent;
  changes: ResumeChange[]; // change set to review (M4); empty when the modifier was off
  modifierConfig: Record<string, boolean> | null;
  aiModel: string | null;
  photoId: string | null;
  updatedAt: string;
};
