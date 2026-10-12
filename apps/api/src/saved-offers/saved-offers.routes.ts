import { Router } from "express";
import { savedOfferListSchema, savedOfferUpdateSchema } from "@job/shared";
import { requireSession, requireUser } from "../auth/session";
import { parseOfferId } from "../offers/offers.routes";
import { listSavedOffers, saveOffer, unsaveOffer, updateSavedOffer } from "./saved-offers";

// Saved offers are addressed by offer id: a user saves an offer at most once.
export const savedOffersRouter = Router();

// GET /api/saved-offers?status=applied&sort=status_changed — anonymous visitors have none.
savedOffersRouter.get("/", async (req, res) => {
  const filter = savedOfferListSchema.parse(req.query);
  res.json(req.user ? await listSavedOffers(req.user.id, filter) : { results: [] });
});

// PUT /api/saved-offers/:offerId — save (creates the guest if needed).
savedOffersRouter.put("/:offerId", requireUser, async (req, res) => {
  const { created, saved } = await saveOffer(req.user!, parseOfferId(req.params.offerId));
  res.status(created ? 201 : 200).json(saved);
});

// PATCH /api/saved-offers/:offerId — status, notes, applied date.
savedOffersRouter.patch("/:offerId", requireSession, async (req, res) => {
  const input = savedOfferUpdateSchema.parse(req.body);
  res.json(await updateSavedOffer(req.user!.id, parseOfferId(req.params.offerId), input));
});

// DELETE /api/saved-offers/:offerId — unsave (permanent; the web app confirms first).
savedOffersRouter.delete("/:offerId", requireSession, async (req, res) => {
  await unsaveOffer(req.user!.id, parseOfferId(req.params.offerId));
  res.status(204).end();
});
