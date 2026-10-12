import { z } from "zod";

// Change set of a generated resume (DATABASE.md "Change set", FEATURE M4).

export const CHANGE_STATUSES = ["pending", "accepted", "rejected", "edited"] as const;
export type ChangeStatus = (typeof CHANGE_STATUSES)[number];

export type ResumeChange = {
  id: string; // c1, c2… unique within the list
  op: "replace" | "add" | "remove" | "reorder";
  // e.g. "summary", "skills[id=s3].name", "workExperience[id=w1].responsibilities[id=r2].text",
  // "skills[id=s9]" (add/remove), "workExperience[id=w1].responsibilities" (reorder)
  path: string;
  // replace: text; add: null; remove: the removed item; reorder: item ids in the original order
  before: unknown;
  // replace: text; add: the added item; remove: null; reorder: item ids in the proposed order
  after: unknown;
  status: ChangeStatus; // pending counts as accepted until reviewed
  flag: "added_skill" | null; // a skill that was not in the original resume
};

// PATCH /api/generated-resumes/:id/changes — accept or reject one or several changes.
export const changeDecisionsSchema = z.strictObject({
  decisions: z.array(z.strictObject({ id: z.string().min(1).max(20), status: z.enum(["accepted", "rejected"]) })).min(1).max(500),
});
