import { Router } from "express";
import { settingsUpdateSchema } from "@job/shared";
import { requireSession, requireUser } from "../auth/session";
import { getSettings, listTemplates, updateSettings } from "./settings";

// GET /api/templates — public (S2).
export const templatesRouter = Router();
templatesRouter.get("/", async (_req, res) => {
  res.json(await listTemplates());
});

export const settingsRouter = Router();

// GET /api/settings
settingsRouter.get("/", requireSession, async (req, res) => {
  res.json(await getSettings(req.user!.id));
});

// PATCH /api/settings — modifier defaults, template, UI language (creates the guest if needed).
settingsRouter.patch("/", requireUser, async (req, res) => {
  const input = settingsUpdateSchema.parse(req.body);
  res.json(await updateSettings(req.user!.id, input));
});
