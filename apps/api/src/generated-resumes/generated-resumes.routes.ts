import { Router } from "express";
import { generatedResumeListSchema, generatedResumeUpdateSchema, generateResumeSchema } from "@job/shared";
import { requireSession, requireUser } from "../auth/session";
import { parseUuid } from "../lib/ids";
import {
  deleteGeneratedResume,
  generatedResumeNotFound,
  generateResume,
  getGeneratedResume,
  listGeneratedResumes,
  renderGeneratedResumeHtml,
  renderGeneratedResumePdf,
  updateGeneratedResume,
} from "./generated-resumes";

export const generatedResumesRouter = Router();

const id = (value: unknown) => parseUuid(value, generatedResumeNotFound);

// GET /api/generated-resumes?offerId=… — history, newest first (M3).
generatedResumesRouter.get("/", async (req, res) => {
  const { offerId } = generatedResumeListSchema.parse(req.query);
  res.json(req.user ? await listGeneratedResumes(req.user.id, offerId) : { results: [] });
});

// POST /api/generated-resumes — generate for an offer (M1).
generatedResumesRouter.post("/", requireUser, async (req, res) => {
  const input = generateResumeSchema.parse(req.body);
  res.status(201).json(await generateResume(req.user!, input));
});

generatedResumesRouter.get("/:id", requireSession, async (req, res) => {
  res.json(await getGeneratedResume(req.user!.id, id(req.params.id)));
});

// PATCH /api/generated-resumes/:id — change template or edit the content (M3).
generatedResumesRouter.patch("/:id", requireSession, async (req, res) => {
  const input = generatedResumeUpdateSchema.parse(req.body);
  res.json(await updateGeneratedResume(req.user!.id, id(req.params.id), input));
});

generatedResumesRouter.delete("/:id", requireSession, async (req, res) => {
  await deleteGeneratedResume(req.user!.id, id(req.params.id));
  res.status(204).end();
});

// GET /api/generated-resumes/:id/html — rendered preview. The CSP blocks scripts and any
// external resource, as a second line of defence behind the template escaping.
generatedResumesRouter.get("/:id/html", requireSession, async (req, res) => {
  const html = await renderGeneratedResumeHtml(req.user!.id, id(req.params.id));
  res
    .set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'self'")
    .type("html")
    .send(html);
});

// GET /api/generated-resumes/:id/pdf — rendered on demand, never stored (M3).
generatedResumesRouter.get("/:id/pdf", requireSession, async (req, res) => {
  const { pdf, fileName } = await renderGeneratedResumePdf(req.user!.id, id(req.params.id));
  res.attachment(fileName).type("application/pdf").send(pdf);
});
