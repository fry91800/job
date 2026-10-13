import express, { Router } from "express";
import { resumeCreateSchema, resumeUpdateSchema, resumeUploadQuerySchema, translateFieldSchema, translateResumeSchema } from "@job/shared";
import { requireSession, requireUser } from "../auth/session";
import { config } from "../config";
import { parseUuid } from "../lib/ids";
import { createTranslation, retranslateField } from "./translations";
import { createResume, deleteResume, getResume, getSourceFile, listResumes, resumeNotFound, selectResume, updateResume, uploadResume } from "./resumes";

export const resumesRouter = Router();

const resumeId = (value: unknown) => parseUuid(value, resumeNotFound);

// GET /api/resumes (R1) — anonymous visitors have none.
resumesRouter.get("/", async (req, res) => {
  res.json(req.user ? await listResumes(req.user.id) : { results: [] });
});

// POST /api/resumes — create from the form (R2 "from scratch").
resumesRouter.post("/", requireUser, async (req, res) => {
  const input = resumeCreateSchema.parse(req.body);
  res.status(201).json(await createResume(req.user!, input));
});

// POST /api/resumes/upload?name=… — raw PDF/DOCX body (R2). The body is the file itself
// (no multipart), which needs no extra library.
resumesRouter.post(
  "/upload",
  express.raw({ type: () => true, limit: config.limits.uploadMaxBytes }),
  requireUser,
  async (req, res) => {
    const { name } = resumeUploadQuerySchema.parse(req.query);
    const file = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    res.status(201).json(await uploadResume(req.user!, req.ip ?? "unknown", file, name));
  },
);

resumesRouter.get("/:id", requireSession, async (req, res) => {
  res.json(await getResume(req.user!.id, resumeId(req.params.id)));
});

// PUT /api/resumes/:id — save the whole resume (R3).
resumesRouter.put("/:id", requireSession, async (req, res) => {
  const input = resumeUpdateSchema.parse(req.body);
  res.json(await updateResume(req.user!.id, resumeId(req.params.id), input));
});

// POST /api/resumes/:id/select (R4)
resumesRouter.post("/:id/select", requireSession, async (req, res) => {
  await selectResume(req.user!.id, resumeId(req.params.id));
  res.status(204).end();
});

// DELETE /api/resumes/:id (R5)
resumesRouter.delete("/:id", requireSession, async (req, res) => {
  await deleteResume(req.user!.id, resumeId(req.params.id));
  res.status(204).end();
});

// POST /api/resumes/:id/translations { language, force? } — translate into a new resume (T1).
resumesRouter.post("/:id/translations", requireSession, async (req, res) => {
  const input = translateResumeSchema.parse(req.body);
  res.status(201).json(await createTranslation(req.user!, req.ip ?? "unknown", resumeId(req.params.id), input));
});

// POST /api/resumes/:id/translate-field { path } — re-translate one field of a translation.
resumesRouter.post("/:id/translate-field", requireSession, async (req, res) => {
  const { path } = translateFieldSchema.parse(req.body);
  res.json(await retranslateField(req.user!.id, req.ip ?? "unknown", resumeId(req.params.id), path));
});

// GET /api/resumes/:id/source — the uploaded file (R5).
resumesRouter.get("/:id/source", requireSession, async (req, res) => {
  const file = await getSourceFile(req.user!.id, resumeId(req.params.id));
  res.attachment(file.fileName).type(file.contentType).send(file.data);
});
