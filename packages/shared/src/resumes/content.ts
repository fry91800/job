import { z } from "zod";

// ResumeContent v1 (DATABASE.md "JSON formats"). One schema for parsing, editing,
// generation and rendering.

export const RESUME_SCHEMA_VERSION = 1;
export const RESUME_LANGUAGES = ["fr", "en"] as const;
export type ResumeLanguage = (typeof RESUME_LANGUAGES)[number];

const MAX_TEXT = 5000;
const MAX_SHORT = 300;
const MAX_ITEMS = 100;

// "No value" is always null, never "": empty strings are turned into null.
const nullableText = (max: number) =>
  z.preprocess((value) => (typeof value === "string" && value.trim() === "" ? null : value), z.string().trim().max(max).nullable());
const requiredText = (max: number) => z.string().trim().min(1).max(max);

// Item ids are created by the API; new items arrive without one (see withItemIds).
const itemId = z.string().regex(/^[A-Za-z0-9_-]{1,32}$/).optional();

// YYYY or YYYY-MM.
const partialDate = nullableText(7).refine((value) => value === null || /^\d{4}(-(0[1-9]|1[0-2]))?$/.test(value), {
  message: "Expected YYYY or YYYY-MM",
});

const textItem = z.strictObject({ id: itemId, text: requiredText(MAX_TEXT) });
const stringList = z.array(requiredText(MAX_SHORT)).max(MAX_ITEMS);

function datesInOrder(item: { startDate: string | null; endDate: string | null }): boolean {
  // "2020" <= "2020-05" compares correctly as strings.
  return item.startDate === null || item.endDate === null || item.startDate <= item.endDate;
}

const workExperience = z
  .strictObject({
    id: itemId,
    jobTitle: requiredText(MAX_SHORT),
    company: requiredText(MAX_SHORT),
    location: nullableText(MAX_SHORT),
    startDate: partialDate,
    endDate: partialDate,
    isCurrent: z.boolean(),
    responsibilities: z.array(textItem).max(MAX_ITEMS),
    technologies: stringList,
  })
  .refine((item) => !item.isCurrent || item.endDate === null, { message: "A current job has no end date", path: ["endDate"] })
  .refine(datesInOrder, { message: "Start date must be before end date", path: ["endDate"] });

const education = z
  .strictObject({
    id: itemId,
    degree: requiredText(MAX_SHORT),
    institution: requiredText(MAX_SHORT),
    location: nullableText(MAX_SHORT),
    startDate: partialDate,
    endDate: partialDate,
    description: nullableText(MAX_TEXT),
  })
  .refine(datesInOrder, { message: "Start date must be before end date", path: ["endDate"] });

export const resumeContentSchema = z
  .strictObject({
    schemaVersion: z.literal(RESUME_SCHEMA_VERSION),
    basics: z.strictObject({
      fullName: requiredText(MAX_SHORT),
      title: nullableText(MAX_SHORT),
      email: nullableText(MAX_SHORT),
      phone: nullableText(50),
      location: z
        .strictObject({ city: nullableText(MAX_SHORT), region: nullableText(MAX_SHORT), country: nullableText(MAX_SHORT) })
        .nullable(),
      links: z.array(z.strictObject({ id: itemId, label: requiredText(MAX_SHORT), url: requiredText(2000) })).max(20),
    }),
    summary: nullableText(MAX_TEXT),
    skills: z.array(z.strictObject({ id: itemId, name: requiredText(MAX_SHORT), category: z.enum(["technical", "soft"]) })).max(MAX_ITEMS),
    workExperience: z.array(workExperience).max(MAX_ITEMS),
    projects: z
      .array(
        z.strictObject({
          id: itemId,
          name: requiredText(MAX_SHORT),
          description: nullableText(MAX_TEXT),
          technologies: stringList,
          link: nullableText(2000),
          highlights: z.array(textItem).max(MAX_ITEMS),
        }),
      )
      .max(MAX_ITEMS),
    education: z.array(education).max(MAX_ITEMS),
    languages: z.array(z.strictObject({ id: itemId, language: requiredText(MAX_SHORT), level: nullableText(MAX_SHORT) })).max(50),
    certifications: z
      .array(z.strictObject({ id: itemId, name: requiredText(MAX_SHORT), issuer: nullableText(MAX_SHORT), date: partialDate }))
      .max(MAX_ITEMS),
    interests: stringList,
  })
  .superRefine((content, ctx) => {
    // Ids must be unique within the document (change review pairs items by id).
    const seen = new Set<string>();
    forEachItem(content, (item) => {
      if (!item.id) return;
      if (seen.has(item.id)) ctx.addIssue({ code: "custom", message: `Duplicate item id "${item.id}"` });
      seen.add(item.id);
    });
  });

// Content as sent by a client: items may lack an id.
export type ResumeContentInput = z.output<typeof resumeContentSchema>;

// Only `id` is optional in the input, so removing optionality (-?) affects ids only.
type WithId<T> = T extends (infer U)[] ? WithId<U>[] : T extends object ? { [K in keyof T]-?: K extends "id" ? string : WithId<T[K]> } : T;

// Content as stored: every array item has an id.
export type ResumeContent = WithId<ResumeContentInput>;

// Calls `visit` on every object that carries an item id.
function forEachItem(content: ResumeContentInput, visit: (item: { id?: string }) => void) {
  content.basics.links.forEach(visit);
  content.skills.forEach(visit);
  for (const job of content.workExperience) {
    visit(job);
    job.responsibilities.forEach(visit);
  }
  for (const project of content.projects) {
    visit(project);
    project.highlights.forEach(visit);
  }
  content.education.forEach(visit);
  content.languages.forEach(visit);
  content.certifications.forEach(visit);
}

// Gives an id to every item that has none. `newId` must return ids not used in the document.
export function withItemIds(content: ResumeContentInput, newId: () => string): ResumeContent {
  const copy = structuredClone(content);
  const used = new Set<string>();
  forEachItem(copy, (item) => item.id && used.add(item.id));
  forEachItem(copy, (item) => {
    if (item.id) return;
    let id = newId();
    while (used.has(id)) id = newId();
    used.add(id);
    item.id = id;
  });
  return copy as ResumeContent;
}

export function emptyResumeContent(fullName: string): ResumeContent {
  return {
    schemaVersion: RESUME_SCHEMA_VERSION,
    basics: { fullName, title: null, email: null, phone: null, location: null, links: [] },
    summary: null,
    skills: [],
    workExperience: [],
    projects: [],
    education: [],
    languages: [],
    certifications: [],
    interests: [],
  };
}
