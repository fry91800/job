import { RESUME_SCHEMA_VERSION } from "../constants";
import type { ResumeContent } from "./content";

// An empty resume (FEATURE R2 "from scratch"), without zod (constants.ts).
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
