import { Router } from "express";
import { locationAutocompleteSchema } from "@job/shared";
import { autocompleteLocations } from "./autocomplete";

export const locationsRouter = Router();

// GET /api/locations?q=brun — location autocomplete for search (FEATURE O1): the
// `locations` table, completed by Geoapify when configured. Prefix matching ignores
// accents ("evry" finds "Évry-Courcouronnes").
locationsRouter.get("/", async (req, res) => {
  const { q } = locationAutocompleteSchema.parse(req.query);
  res.json(await autocompleteLocations(q));
});
