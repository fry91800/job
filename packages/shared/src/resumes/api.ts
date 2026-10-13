import { z } from "zod";
import { RESUME_LANGUAGES, resumeContentSchema, type ResumeContent } from "./content";

// Resumes (FEATURE R1–R5).

const name = z.string().trim().min(1).max(100);

export const resumeCreateSchema = z.object({
  name: name.optional(), // defaults to "Resume {n}"
  language: z.enum(RESUME_LANGUAGES),
  content: resumeContentSchema,
});

export const resumeUpdateSchema = z.object({
  name,
  language: z.enum(RESUME_LANGUAGES),
  content: resumeContentSchema,
});

export const resumeUploadQuerySchema = z.object({ name: name.optional() });

// Translation (FEATURE T1).
export const translateResumeSchema = z.strictObject({
  language: z.enum(RESUME_LANGUAGES),
  // Create a new translation even if one already exists in that language.
  force: z.boolean().optional(),
});

// "Re-translate" one field of a translated resume, e.g. "summary" or
// "workExperience[id=w1].responsibilities[id=r2].text". The text is returned, not saved.
export const translateFieldSchema = z.strictObject({ path: z.string().min(1).max(200) });
export type TranslateFieldResponse = { path: string; text: string };

export type ResumeListItem = {
  id: string;
  name: string;
  language: string;
  isSelected: boolean;
  hasSourceFile: boolean;
  // The source of a translation (T1); `changedSinceTranslation` when the source was edited
  // after the translation was created ("Translate again").
  translatedFrom: { id: string; name: string; changedSinceTranslation: boolean } | null;
  updatedAt: string;
};

export type ResumeListResponse = { results: ResumeListItem[] };

export type ResumeDetail = ResumeListItem & {
  content: ResumeContent;
  // Catalogue links extracted from the content (M2), as used for the match %.
  skillIds: number[];
  occupationIds: number[];
  createdAt: string;
};
