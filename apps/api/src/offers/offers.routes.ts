import { Router } from "express";
import { offerDetailQuerySchema, offerSearchSchema } from "@job/shared";
import { HttpError } from "../lib/http-error";
import { parseUuid } from "../lib/ids";
import { prisma } from "../lib/prisma";
import { getOfferDetail } from "./offer-detail";
import { searchOffers } from "./offer-search";

export const offersRouter = Router();

export function parseOfferId(value: unknown): string {
  return parseUuid(value, () => new HttpError(404, "offer_not_found", "Offer not found"));
}

// GET /api/offers — search public offers (FEATURE O1).
offersRouter.get("/", async (req, res) => {
  const params = offerSearchSchema.parse(req.query);
  const response = await searchOffers(params, req.user?.id);

  // Remember the last searched location for users who already exist; a search
  // alone never creates a guest.
  if (req.user && params.locationId !== undefined) {
    await prisma.user.update({ where: { id: req.user.id }, data: { searchLocationId: params.locationId } });
  }

  res.json(response);
});

// GET /api/offers/:id — offer detail (FEATURE O2).
offersRouter.get("/:id", async (req, res) => {
  const { lang } = offerDetailQuerySchema.parse(req.query);
  res.json(await getOfferDetail(parseOfferId(req.params.id), req.user?.id, lang));
});
