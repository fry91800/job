import { Router } from "express";
import { polishLinesSchema, suggestedSkillsQuerySchema, writeSummarySchema } from "@job/shared";
import { consumeAiRateLimit } from "../ai/rate-limit";
import { polishLines, suggestedSkills, writeSummary } from "./resume-help";

// Help for writing a resume from scratch (FEATURE R7). Open to visitors without an account
// (the resume is created at the end); the AI calls share the per-address AI limit.
export const resumeHelpRouter = Router();

// GET /api/resume-help/skills?title=…&language=fr — skills employers ask for that job.
resumeHelpRouter.get("/skills", async (req, res) => {
  const { title, language } = suggestedSkillsQuerySchema.parse(req.query);
  res.set("Cache-Control", "private, max-age=3600").json(await suggestedSkills(title, language));
});

// POST /api/resume-help/polish — an experience's lines, reworded.
resumeHelpRouter.post("/polish", async (req, res) => {
  const input = polishLinesSchema.parse(req.body);
  consumeAiRateLimit(req.ip ?? "unknown");
  res.json(await polishLines(input));
});

// POST /api/resume-help/summary — the profile summary.
resumeHelpRouter.post("/summary", async (req, res) => {
  const input = writeSummarySchema.parse(req.body);
  consumeAiRateLimit(req.ip ?? "unknown");
  res.json(await writeSummary(input));
});
