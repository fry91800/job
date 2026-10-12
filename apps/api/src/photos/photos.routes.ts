import express, { Router } from "express";
import { photoRenameSchema, photoUploadQuerySchema } from "@job/shared";
import { requireSession, requireUser } from "../auth/session";
import { config } from "../config";
import { parseUuid } from "../lib/ids";
import { deletePhoto, getPhotoFile, listPhotos, photoNotFound, renamePhoto, selectPhoto, uploadPhoto } from "./photos";

export const photosRouter = Router();

const photoId = (value: unknown) => parseUuid(value, photoNotFound);

// GET /api/photos — anonymous visitors have none.
photosRouter.get("/", async (req, res) => {
  res.json(req.user ? await listPhotos(req.user.id) : { results: [] });
});

// POST /api/photos?name=… — raw image body, like resume uploads.
photosRouter.post(
  "/",
  express.raw({ type: () => true, limit: config.limits.uploadMaxBytes }),
  requireUser,
  async (req, res) => {
    const { name } = photoUploadQuerySchema.parse(req.query);
    const file = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    res.status(201).json(await uploadPhoto(req.user!, file, name));
  },
);

// DELETE /api/photos/selection — "no photo".
photosRouter.delete("/selection", requireSession, async (req, res) => {
  await selectPhoto(req.user!.id, null);
  res.status(204).end();
});

photosRouter.patch("/:id", requireSession, async (req, res) => {
  const { name } = photoRenameSchema.parse(req.body);
  res.json(await renamePhoto(req.user!.id, photoId(req.params.id), name));
});

photosRouter.post("/:id/select", requireSession, async (req, res) => {
  await selectPhoto(req.user!.id, photoId(req.params.id));
  res.status(204).end();
});

photosRouter.delete("/:id", requireSession, async (req, res) => {
  await deletePhoto(req.user!.id, photoId(req.params.id));
  res.status(204).end();
});

// GET /api/photos/:id/file — the image, for its owner only (never public).
photosRouter.get("/:id/file", requireSession, async (req, res) => {
  const file = await getPhotoFile(req.user!.id, photoId(req.params.id));
  res.set("Cache-Control", "private, max-age=3600").type(file.contentType).send(file.data);
});
