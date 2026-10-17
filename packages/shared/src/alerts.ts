import { z } from "zod";

// Job alerts (GROWTH.md phase 2): a saved search whose new offers are emailed.

export const MAX_JOB_ALERTS = 10;
export const JOB_ALERT_FREQUENCIES = ["daily", "weekly"] as const;
export type JobAlertFrequency = (typeof JOB_ALERT_FREQUENCIES)[number];

// POST /api/alerts — `query`: the search as in the app's address (q=…&locationId=…&location=…),
// without sort, page or publication date (an alert sends what is new since the last email).
export const jobAlertCreateSchema = z.object({
  query: z.string().max(1000),
  label: z.string().trim().min(1).max(200),
  frequency: z.enum(JOB_ALERT_FREQUENCIES).default("daily"),
});

// PATCH /api/alerts/:id
export const jobAlertUpdateSchema = z.object({
  frequency: z.enum(JOB_ALERT_FREQUENCIES).optional(),
  paused: z.boolean().optional(),
});

export type JobAlert = {
  id: string;
  label: string;
  query: string;
  frequency: JobAlertFrequency;
  paused: boolean;
  lastSentAt: string | null;
  createdAt: string;
};

export type JobAlertListResponse = { results: JobAlert[] };
