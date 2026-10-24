import { z } from "zod";

// Cover letters for an offer (FEATURE M5): written by the AI from a resume and the offer,
// in the offer's language (French or English), then edited by the user.

export const COVER_LETTER_SUBJECT_MAX_LENGTH = 200;
export const COVER_LETTER_BODY_MAX_LENGTH = 6000;

export const writeCoverLetterSchema = z.strictObject({
  offerId: z.uuid(),
  resumeId: z.uuid().optional(), // defaults to the selected resume
});

export const coverLetterUpdateSchema = z
  .strictObject({
    subject: z.string().trim().min(1).max(COVER_LETTER_SUBJECT_MAX_LENGTH),
    body: z.string().trim().min(1).max(COVER_LETTER_BODY_MAX_LENGTH),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: "Nothing to update" });

export const coverLetterListSchema = z.object({ offerId: z.uuid().optional() });

// The letter's header: who writes (from the resume) and to whom (from the offer).
export type CoverLetterSender = { name: string | null; title: string | null; email: string | null; phone: string | null; location: string | null };
export type CoverLetterRecipient = { company: string | null; place: string | null };

export type CoverLetterListItem = {
  id: string;
  offer: { id: string; title: string; companyName: string | null };
  resume: { id: string; name: string } | null;
  language: string;
  subject: string;
  createdAt: string;
};

export type CoverLetterDetail = CoverLetterListItem & {
  body: string; // salutation, paragraphs and closing, separated by blank lines
  sender: CoverLetterSender;
  recipient: CoverLetterRecipient;
  updatedAt: string;
};

export type CoverLetterListResponse = { results: CoverLetterListItem[] };
