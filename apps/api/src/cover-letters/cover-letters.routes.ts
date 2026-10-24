import { Router } from "express";
import { coverLetterListSchema, coverLetterUpdateSchema, writeCoverLetterSchema } from "@job/shared";
import { requireSession, requireUser } from "../auth/session";
import { parseUuid } from "../lib/ids";
import { coverLetterNotFound, deleteCoverLetter, getCoverLetter, listCoverLetters, renderCoverLetterHtml, renderCoverLetterPdf, updateCoverLetter, writeCoverLetter } from "./cover-letters";

// Cover letters (FEATURE M5).
export const coverLettersRouter = Router();

const id = (value: unknown) => parseUuid(value, coverLetterNotFound);

// GET /api/cover-letters?offerId=… — newest first.
coverLettersRouter.get("/", async (req, res) => {
  const { offerId } = coverLetterListSchema.parse(req.query);
  res.json(req.user ? await listCoverLetters(req.user.id, offerId) : { results: [] });
});

// POST /api/cover-letters — written by the AI for an offer.
coverLettersRouter.post("/", requireUser, async (req, res) => {
  const input = writeCoverLetterSchema.parse(req.body);
  res.status(201).json(await writeCoverLetter(req.user!, input, req.ip ?? "unknown"));
});

coverLettersRouter.get("/:id", requireSession, async (req, res) => {
  res.json(await getCoverLetter(req.user!.id, id(req.params.id)));
});

// PATCH /api/cover-letters/:id — the user's edits to the subject or the text.
coverLettersRouter.patch("/:id", requireSession, async (req, res) => {
  res.json(await updateCoverLetter(req.user!.id, id(req.params.id), coverLetterUpdateSchema.parse(req.body)));
});

coverLettersRouter.delete("/:id", requireSession, async (req, res) => {
  await deleteCoverLetter(req.user!.id, id(req.params.id));
  res.status(204).end();
});

// GET /api/cover-letters/:id/html — the page preview; the CSP blocks scripts and external
// resources behind the template's escaping.
coverLettersRouter.get("/:id/html", requireSession, async (req, res) => {
  const html = await renderCoverLetterHtml(req.user!.id, id(req.params.id));
  res.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; font-src data:; frame-ancestors 'self'").type("html").send(html);
});

// GET /api/cover-letters/:id/pdf — rendered on demand, never stored.
coverLettersRouter.get("/:id/pdf", requireSession, async (req, res) => {
  const { pdf, fileName } = await renderCoverLetterPdf(req.user!.id, id(req.params.id));
  res.attachment(fileName).type("application/pdf").send(pdf);
});
