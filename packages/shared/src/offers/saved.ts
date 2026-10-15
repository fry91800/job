import { z } from "zod";
import type { OfferSearchResult } from "./search";
import { SAVED_OFFER_NOTES_MAX_LENGTH, SAVED_OFFER_STATUSES, type SavedOfferStatus } from "../constants";

// Saved offers with application tracking (FEATURE O3).

export { SAVED_OFFER_NOTES_MAX_LENGTH, SAVED_OFFER_STATUSES, type SavedOfferStatus } from "../constants";

export const savedOfferListSchema = z.object({
  status: z.preprocess((value) => (value === "" ? undefined : value), z.enum(SAVED_OFFER_STATUSES).optional()),
  sort: z.preprocess((value) => (value === "" ? undefined : value), z.enum(["saved", "status_changed"]).default("saved")),
});

// Every field is optional; at least one must be sent.
export const savedOfferUpdateSchema = z
  .object({
    status: z.enum(SAVED_OFFER_STATUSES).optional(),
    notes: z.string().max(SAVED_OFFER_NOTES_MAX_LENGTH).nullable().optional(),
    appliedAt: z.iso.datetime({ offset: true }).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "Nothing to update" });

export type SavedOfferInfo = {
  status: SavedOfferStatus;
  notes: string | null;
  appliedAt: string | null;
  statusChangedAt: string;
  savedAt: string;
};

export type SavedOfferListItem = SavedOfferInfo & {
  offer: Pick<OfferSearchResult, "id" | "title" | "companyName" | "location" | "remoteType" | "contractType" | "salary" | "publishedAt"> & {
    closed: boolean; // flagged in the list (FEATURE O3)
  };
};

export type SavedOfferListResponse = { results: SavedOfferListItem[] };
