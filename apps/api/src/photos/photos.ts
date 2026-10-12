import sharp from "sharp";
import type { UserPhoto } from "@prisma/client";
import type { Photo, PhotoListResponse } from "@job/shared";
import { config } from "../config";
import { HttpError } from "../lib/http-error";
import { prisma } from "../lib/prisma";
import { getFile, newStorageKey, putFile } from "../lib/storage";

// Photos (FEATURE R6). Stored as WebP, at most 1000 px, without any metadata.

type SessionUser = { id: string; isGuest: boolean };

export const photoNotFound = () => new HttpError(404, "photo_not_found", "Photo not found");

function toPhoto(photo: UserPhoto, selectedPhotoId: string | null): Photo {
  return {
    id: photo.id,
    name: photo.name,
    isSelected: photo.id === selectedPhotoId,
    sizeBytes: photo.sizeBytes,
    createdAt: photo.createdAt.toISOString(),
  };
}

async function selectedPhotoId(userId: string): Promise<string | null> {
  return (await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { selectedPhotoId: true } })).selectedPhotoId;
}

async function findOwnPhoto(userId: string, photoId: string): Promise<UserPhoto> {
  const photo = await prisma.userPhoto.findFirst({ where: { id: photoId, userId, deletedAt: null } });
  if (!photo) throw photoNotFound();
  return photo;
}

export async function listPhotos(userId: string): Promise<PhotoListResponse> {
  const [photos, selected] = await Promise.all([
    prisma.userPhoto.findMany({ where: { userId, deletedAt: null }, orderBy: [{ createdAt: "desc" }, { id: "asc" }] }),
    selectedPhotoId(userId),
  ]);
  return { results: photos.map((photo) => toPhoto(photo, selected)) };
}

// JPEG, PNG and WEBP only, recognized from the content. Returns the cleaned image:
// EXIF orientation applied, then every metadata (GPS position, camera…) dropped.
async function processImage(file: Buffer): Promise<Buffer> {
  let format: string | undefined;
  try {
    format = (await sharp(file).metadata()).format;
  } catch {
    format = undefined;
  }
  if (!format || !["jpeg", "png", "webp"].includes(format)) {
    throw new HttpError(415, "unsupported_file_type", "Only JPEG, PNG and WEBP images are accepted");
  }
  const size = config.limits.photoMaxPixels;
  return sharp(file).rotate().resize(size, size, { fit: "inside", withoutEnlargement: true }).webp({ quality: 85 }).toBuffer();
}

// Upload (R6). The first photo is selected automatically.
export async function uploadPhoto(user: SessionUser, file: Buffer, name: string | undefined): Promise<Photo> {
  if (file.length === 0) throw new HttpError(400, "empty_file", "The file is empty");
  const limit = user.isGuest ? config.limits.photos.guest : config.limits.photos.registered;
  const count = await prisma.userPhoto.count({ where: { userId: user.id, deletedAt: null } });
  if (count >= limit) throw new HttpError(429, "limit_reached", `You can keep at most ${limit} photos`);

  const image = await processImage(file);
  const key = newStorageKey("photos", user.id, "webp");
  await putFile(key, image);

  const photo = await prisma.$transaction(async (tx) => {
    const created = await tx.userPhoto.create({
      data: { userId: user.id, name: name ?? `Photo ${count + 1}`, storageKey: key, mimeType: "image/webp", sizeBytes: image.length },
    });
    await tx.user.updateMany({ where: { id: user.id, selectedPhotoId: null }, data: { selectedPhotoId: created.id } });
    return created;
  });
  return toPhoto(photo, await selectedPhotoId(user.id));
}

export async function renamePhoto(userId: string, photoId: string, name: string): Promise<Photo> {
  await findOwnPhoto(userId, photoId);
  const photo = await prisma.userPhoto.update({ where: { id: photoId }, data: { name } });
  return toPhoto(photo, await selectedPhotoId(userId));
}

// photoId null = "no photo", a valid choice (R6).
export async function selectPhoto(userId: string, photoId: string | null): Promise<void> {
  if (photoId) await findOwnPhoto(userId, photoId);
  await prisma.user.update({ where: { id: userId }, data: { selectedPhotoId: photoId } });
}

// Soft delete; clears the selection. Generated resumes keep showing the photo until
// the purge job deletes the file.
export async function deletePhoto(userId: string, photoId: string): Promise<void> {
  await findOwnPhoto(userId, photoId);
  await prisma.$transaction([
    prisma.user.updateMany({ where: { id: userId, selectedPhotoId: photoId }, data: { selectedPhotoId: null } }),
    prisma.userPhoto.update({ where: { id: photoId }, data: { deletedAt: new Date() } }),
  ]);
}

export async function getPhotoFile(userId: string, photoId: string) {
  const photo = await findOwnPhoto(userId, photoId);
  return { data: await getFile(photo.storageKey), contentType: photo.mimeType };
}

// For rendering a generated resume: the photo as a data URL, or null once its file is
// gone (purged). Soft-deleted photos still render (R6).
export async function photoDataUrl(photoId: string | null): Promise<string | null> {
  if (!photoId) return null;
  const photo = await prisma.userPhoto.findUnique({ where: { id: photoId } });
  if (!photo) return null;
  try {
    return `data:${photo.mimeType};base64,${(await getFile(photo.storageKey)).toString("base64")}`;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
