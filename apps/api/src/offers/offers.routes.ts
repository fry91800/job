import { Router } from "express";
import { offerSearchSchema } from "@job/shared";
import { prisma } from "../lib/prisma";
import { searchOffers } from "./offer-search";

export const offersRouter = Router();

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
