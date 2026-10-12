import { z } from "zod";
import { UI_LANGUAGES } from "../auth";
import type { SavedOfferInfo } from "./saved";
import type { OfferSearchResult } from "./search";

// GET /api/offers/:id (FEATURE O2)
export const offerDetailQuerySchema = z.object({
  // Language of the skill and occupation names; defaults to the user's UI language.
  lang: z.preprocess((value) => (value === "" ? undefined : value), z.enum(UI_LANGUAGES).optional()),
});

export type CatalogueItem = { id: number; name: string };

export type OfferDetail = Omit<OfferSearchResult, "locationMatch" | "distanceKm" | "saved" | "skillIds" | "occupationIds"> & {
  description: string; // simplified Markdown, render with HTML escaped
  language: string | null;
  url: string | null;
  isPublic: boolean;
  isOwn: boolean; // user-added offer created by the current user (FEATURE O5)
  closedAt: string | null; // shown with a "no longer available" banner
  skills: CatalogueItem[];
  occupations: CatalogueItem[];
  saved: SavedOfferInfo | null;
  generatedResumes: { id: string; language: string; matchScore: number | null; createdAt: string }[];
};
