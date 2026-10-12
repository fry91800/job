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

export type ResumeListItem = {
  id: string;
  name: string;
  language: string;
  isSelected: boolean;
  hasSourceFile: boolean;
  translatedFrom: { id: string; name: string } | null;
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
