import { z } from "zod";
import type { LocationSummary } from "../locations";
import { CONTRACT_TYPES, REMOTE_TYPES, SALARY_PERIODS } from "./search";

// User-added offers (FEATURE O5).

const TRACKING_PARAMS = /^(utm_\w+|gclid|gbraid|wbraid|fbclid|msclkid|mc_cid|mc_eid|_hsenc|_hsmi|igshid|trk|trkInfo|trackingId|refId|si)$/i;

// Normalized form of an offer URL (DATABASE.md "offers": scheme + host lowercased,
// tracking parameters removed). Also used by the collector, so the same page always
// gives the same `offers.url`. Returns null for anything that is not an http(s) URL.
export function normalizeOfferUrl(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;

  url.hash = "";
  const kept = [...url.searchParams].filter(([key]) => !TRACKING_PARAMS.test(key));
  kept.sort(([a], [b]) => a.localeCompare(b));
  url.search = new URLSearchParams(kept).toString();
  // URL already lowercases the scheme and host and drops default ports.
  return url.toString();
}

const offerUrl = z
  .string()
  .max(2000)
  .transform((value, ctx) => {
    const normalized = normalizeOfferUrl(value);
    if (!normalized) ctx.addIssue({ code: "custom", message: "Expected an http(s) URL" });
    return normalized ?? "";
  });

// Step 1: extract fields from a URL or from pasted text.
export const offerExtractSchema = z.union([
  z.strictObject({ url: offerUrl }),
  z.strictObject({ text: z.string().trim().min(20).max(50000) }),
]);

const optionalText = (max: number) =>
  z.preprocess((value) => (typeof value === "string" && value.trim() === "" ? null : value), z.string().trim().max(max).nullable().optional());

// Step 2: the fields reviewed by the user. Also used to edit a private offer.
export const offerDraftSchema = z
  .strictObject({
    title: z.string().trim().min(1).max(300),
    companyName: optionalText(300),
    description: z.string().trim().min(1).max(50000), // simplified Markdown; pasted line breaks are kept
    language: z.enum(["fr", "en"]).nullable().optional(),
    url: offerUrl.nullable().optional(),
    locationId: z.number().int().positive().nullable().optional(),
    remoteType: z.enum(REMOTE_TYPES).nullable().optional(),
    contractType: z.enum(CONTRACT_TYPES).nullable().optional(),
    salaryMin: z.number().int().nonnegative().nullable().optional(),
    salaryMax: z.number().int().nonnegative().nullable().optional(),
    salaryCurrency: z.string().regex(/^[A-Z]{3}$/).nullable().optional(),
    salaryPeriod: z.enum(SALARY_PERIODS).nullable().optional(),
  })
  .refine((offer) => offer.salaryMin == null || offer.salaryMax == null || offer.salaryMin <= offer.salaryMax, {
    message: "salaryMin must be ≤ salaryMax",
    path: ["salaryMax"],
  })
  .refine((offer) => (offer.salaryMin == null && offer.salaryMax == null) || (offer.salaryCurrency != null && offer.salaryPeriod != null), {
    message: "A salary needs a currency and a period",
    path: ["salaryCurrency"],
  });

export type OfferDraft = z.output<typeof offerDraftSchema>;

// Response of the extract step: either a draft to review (with its detected place, for
// display), or the existing offer with the same URL (already saved for the user).
export type OfferExtractResponse = { draft: OfferDraft; location: LocationSummary | null } | { existingOfferId: string };
