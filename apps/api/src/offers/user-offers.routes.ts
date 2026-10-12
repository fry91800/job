import { Router } from "express";
import { offerDraftSchema, offerExtractSchema } from "@job/shared";
import { requireSession, requireUser } from "../auth/session";
import { parseOfferId } from "./offers.routes";
import { createUserOffer, extractUserOffer, updateUserOffer } from "./user-offers";

// User-added offers (FEATURE O5).
export const userOffersRouter = Router();

// POST /api/user-offers/extract { url } | { text } — a draft to review, or the existing
// offer with that URL (saved for the user).
userOffersRouter.post("/extract", requireUser, async (req, res) => {
  const input = offerExtractSchema.parse(req.body);
  res.json(await extractUserOffer(req.user!, req.ip ?? "unknown", input));
});

// POST /api/user-offers — create the private offer from the reviewed draft.
userOffersRouter.post("/", requireUser, async (req, res) => {
  const draft = offerDraftSchema.parse(req.body);
  res.status(201).json(await createUserOffer(req.user!, draft));
});

// PUT /api/user-offers/:id — edit (creator only, while private).
userOffersRouter.put("/:id", requireSession, async (req, res) => {
  const draft = offerDraftSchema.parse(req.body);
  res.json(await updateUserOffer(req.user!.id, parseOfferId(req.params.id), draft));
});
