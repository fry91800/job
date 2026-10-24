import { z } from "zod";

// Help for writing a resume from scratch (FEATURE R7): skills employers ask for a job, and
// the AI's rewording of what the user wrote, truthful to it.

const language = z.enum(["fr", "en"]);
const short = z.string().trim().min(1).max(200);

export const suggestedSkillsQuerySchema = z.object({ title: short, language: language.default("fr") });
export type SuggestedSkillsResponse = { skills: string[] };

// "Reformuler": one experience's lines, in the user's words.
export const polishLinesSchema = z.strictObject({
  language,
  jobTitle: short,
  company: z.string().trim().max(200).nullable().optional(),
  lines: z.array(z.string().trim().min(2).max(400)).min(1).max(15),
});
export type PolishLinesResponse = { lines: string[] };

// "Rédiger avec l'IA": the profile summary, from what the user entered.
export const writeSummarySchema = z.strictObject({
  language,
  targetTitle: short,
  experiences: z.array(z.strictObject({ jobTitle: short, company: z.string().trim().max(200).nullable(), lines: z.array(z.string().trim().max(400)).max(15) })).max(20),
  education: z.array(z.strictObject({ degree: short, institution: z.string().trim().max(200).nullable(), current: z.boolean() })).max(10),
  skills: z.array(short).max(40),
});
export type WriteSummaryResponse = { summary: string };
