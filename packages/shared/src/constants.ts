// Plain values shared by the API and the web app, without zod: the web app imports them
// from here (and match.ts) so that its first load doesn't include the validation library
// and every API schema (FRONTEND.md §5). The modules that define the schemas re-export
// them, so "@job/shared" offers the same names as before.

// Accounts (FEATURE A1, L1)
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;
export const UI_LANGUAGES = ["fr", "en"] as const;
export type UiLanguage = (typeof UI_LANGUAGES)[number];

// Locations (DATABASE.md "locations")
export const LOCATION_TYPES = ["city", "county", "region", "country"] as const;
export type LocationType = (typeof LOCATION_TYPES)[number];

// Offer search (FEATURE O1)
export const SEARCH_PAGE_SIZE = 20;
export const SEARCH_RADIUS_CHOICES = [0, 10, 25, 50, 100] as const;
export const DEFAULT_SEARCH_RADIUS_KM = 25;
export const MAX_SEARCH_SKILLS = 20;
export const REMOTE_TYPES = ["onsite", "hybrid", "remote"] as const;
export const CONTRACT_TYPES = ["permanent", "fixed_term", "temporary", "freelance", "internship", "apprenticeship", "other"] as const;
export const SALARY_PERIODS = ["hour", "day", "month", "year"] as const;
export const PUBLISHED_WITHIN = ["24h", "7d", "30d"] as const;
export const SEARCH_SORTS = ["recent", "relevance"] as const;
export type RemoteType = (typeof REMOTE_TYPES)[number];
export type ContractType = (typeof CONTRACT_TYPES)[number];
export type SalaryPeriod = (typeof SALARY_PERIODS)[number];

// Saved offers (FEATURE O3)
export const SAVED_OFFER_STATUSES = ["saved", "applied", "interviewing", "offer_received", "rejected", "withdrawn"] as const;
export type SavedOfferStatus = (typeof SAVED_OFFER_STATUSES)[number];
export const SAVED_OFFER_NOTES_MAX_LENGTH = 5000;

// Resumes (DATABASE.md "JSON formats")
export const RESUME_SCHEMA_VERSION = 1;
export const RESUME_LANGUAGES = ["fr", "en"] as const;
export type ResumeLanguage = (typeof RESUME_LANGUAGES)[number];

// Resume modifier (FEATURE S1)
export const MODIFIER_STRENGTHS = ["soft", "medium", "hard"] as const;
export type ModifierStrength = (typeof MODIFIER_STRENGTHS)[number];
export const MODIFIER_SECTIONS = ["summary", "title", "skills", "workExperience", "projects"] as const;

// Change review (FEATURE M4)
export const CHANGE_STATUSES = ["pending", "accepted", "rejected", "edited"] as const;
export type ChangeStatus = (typeof CHANGE_STATUSES)[number];
