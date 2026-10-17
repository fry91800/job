import { z } from "zod";
import { emailSchema } from "./auth";

// Feedback from the app's "Un avis ?" form (GROWTH.md phase 0), emailed to the operator.
export const FEEDBACK_MAX_LENGTH = 5000;

export const feedbackSchema = z.object({
  message: z.string().trim().min(1).max(FEEDBACK_MAX_LENGTH),
  email: emailSchema.optional(), // to answer; the account's address is suggested
  page: z.string().max(300).optional(), // where the form was opened
});

export type FeedbackInput = z.input<typeof feedbackSchema>;

// GET /api/public-config: settings the web app reads at start.
export type PublicConfigResponse = {
  // Audience measurement (Umami, served on the site's own address under /u/); null when off.
  analytics: { websiteId: string; domain: string } | null;
};
