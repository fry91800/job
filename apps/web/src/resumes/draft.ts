import type { ResumeContent } from "@job/shared";
import { emptyResumeContent } from "@job/shared/src/resumes/empty";
import { newId } from "./fields";

// The from-scratch resume draft (FEATURE R7, ResumeWizard): what the user enters, and the
// resume it becomes.

export type Experience = { id: string; jobTitle: string; company: string; city: string; start: string; end: string; current: boolean; lines: string };
export type Study = { id: string; degree: string; institution: string; city: string; start: string; end: string; current: boolean };
export type Draft = {
  step: number;
  language: "fr" | "en";
  name: string;
  title: string;
  city: string;
  email: string;
  phone: string;
  experiences: Experience[];
  studies: Study[];
  skills: string[];
  languages: { id: string; language: string; level: string }[];
  summary: string;
};

export const STORAGE_KEY = "monposte.resumeDraft";
export const STEPS = ["you", "experience", "education", "skills", "summary"] as const;
export const emptyExperience = (): Experience => ({ id: newId(), jobTitle: "", company: "", city: "", start: "", end: "", current: false, lines: "" });
export const emptyStudy = (): Study => ({ id: newId(), degree: "", institution: "", city: "", start: "", end: "", current: false });
export const freshDraft = (): Draft => ({ step: 0, language: "fr", name: "", title: "", city: "", email: "", phone: "", experiences: [emptyExperience()], studies: [emptyStudy()], skills: [], languages: [{ id: newId(), language: "Français", level: "Langue maternelle" }], summary: "" });

export function loadDraft(): Draft {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return { ...freshDraft(), ...(JSON.parse(saved) as Partial<Draft>) };
  } catch {
    // No storage (private window): start afresh.
  }
  return freshDraft();
}

export const lines = (text: string) => text.split("\n").map((line) => line.replace(/^\s*[-•·*]\s*/, "").trim()).filter(Boolean);
export const filled = (value: string) => value.trim() || null;
const SOFT = /équipe|communication|autonom|rigueur|organisation|relationnel|adaptab|ponctualit|écoute|polyvalen|team|organized|curiosit|patience|empathie/i;

// The draft as a resume (only complete entries: a job needs its title and employer, a study
// its degree and school).
export function draftToContent(draft: Draft): ResumeContent {
  const base = emptyResumeContent(draft.name.trim());
  return {
    ...base,
    basics: { ...base.basics, title: filled(draft.title), email: filled(draft.email), phone: filled(draft.phone), location: draft.city.trim() ? { city: draft.city.trim(), region: null, country: null } : null },
    summary: filled(draft.summary),
    workExperience: draft.experiences
      .filter((job) => job.jobTitle.trim() && job.company.trim())
      .map((job) => ({
        id: job.id,
        jobTitle: job.jobTitle.trim(),
        company: job.company.trim(),
        location: filled(job.city),
        startDate: job.start || null,
        endDate: job.current ? null : job.end || null,
        isCurrent: job.current,
        responsibilities: lines(job.lines).map((text) => ({ id: newId(), text })),
        technologies: [],
      })),
    education: draft.studies
      .filter((study) => study.degree.trim() && study.institution.trim())
      .map((study) => ({ id: study.id, degree: study.degree.trim(), institution: study.institution.trim(), location: filled(study.city), startDate: study.start || null, endDate: study.current ? null : study.end || null, description: study.current ? (draft.language === "fr" ? "En cours" : "In progress") : null })),
    skills: draft.skills.map((name) => ({ id: newId(), name, category: SOFT.test(name) ? ("soft" as const) : ("technical" as const) })),
    languages: draft.languages.filter((item) => item.language.trim()).map((item) => ({ id: item.id, language: item.language.trim(), level: filled(item.level) })),
  };
}

