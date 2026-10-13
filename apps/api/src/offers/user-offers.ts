import { Prisma } from "@prisma/client";
import type { OfferDetail, OfferDraft, OfferExtractResponse } from "@job/shared";
import { consumeAiRateLimit } from "../ai/rate-limit";
import { config } from "../config";
import { HttpError } from "../lib/http-error";
import { prisma } from "../lib/prisma";
import { saveOffer } from "../saved-offers/saved-offers";
import { syncOfferLinks } from "./offer-catalogue";
import { getOfferDetail } from "./offer-detail";
import { extractOfferDraft } from "./offer-extractor";

// User-added offers (FEATURE O5): extract → the user reviews the draft → create a
// private offer, saved for its creator.

type SessionUser = { id: string; isGuest: boolean };

// Counted from the created offers (FEATURE G4); offers are never deleted.
async function checkQuota(user: SessionUser): Promise<void> {
  const { guestTotal, registeredPerDay } = config.limits.userOffers;
  const since = user.isGuest ? undefined : new Date(Date.now() - 24 * 3600 * 1000);
  const count = await prisma.offer.count({ where: { createdByUserId: user.id, ...(since && { createdAt: { gte: since } }) } });
  if (count >= (user.isGuest ? guestTotal : registeredPerDay)) {
    throw new HttpError(429, "limit_reached", user.isGuest ? "Create an account to add more offers" : "Daily limit of added offers reached");
  }
}

function offerExists(id: string) {
  return new HttpError(409, "offer_exists", "An offer with this URL already exists", { existingOfferId: id });
}

export async function extractUserOffer(user: SessionUser, ip: string, input: { url: string } | { text: string }): Promise<OfferExtractResponse> {
  // Known URL: reuse the existing offer, just save it for the user (no extraction).
  if ("url" in input) {
    const existing = await prisma.offer.findUnique({ where: { url: input.url }, select: { id: true } });
    if (existing) {
      await saveOffer(user, existing.id, { requireVisible: false });
      return { existingOfferId: existing.id };
    }
  }

  await checkQuota(user);
  consumeAiRateLimit(ip);
  return { draft: await extractOfferDraft(input) };
}

async function checkLocation(locationId: number | null | undefined) {
  if (locationId == null) return;
  if (!(await prisma.location.findUnique({ where: { id: locationId }, select: { id: true } }))) {
    throw new HttpError(400, "unknown_location", "This location does not exist");
  }
}

function offerFields(draft: OfferDraft) {
  return {
    title: draft.title,
    companyName: draft.companyName ?? null,
    description: draft.description,
    language: draft.language ?? null,
    url: draft.url ?? null,
    locationId: draft.locationId ?? null,
    remoteType: draft.remoteType ?? null,
    contractType: draft.contractType ?? null,
    salaryMin: draft.salaryMin ?? null,
    salaryMax: draft.salaryMax ?? null,
    salaryCurrency: draft.salaryCurrency ?? null,
    salaryPeriod: draft.salaryPeriod ?? null,
  };
}

const isUrlConflict = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" && JSON.stringify(error.meta ?? {}).includes("url");

export async function createUserOffer(user: SessionUser, draft: OfferDraft): Promise<OfferDetail> {
  await checkQuota(user);
  await checkLocation(draft.locationId);
  if (draft.url) {
    const existing = await prisma.offer.findUnique({ where: { url: draft.url }, select: { id: true } });
    if (existing) throw offerExists(existing.id);
  }

  const fields = offerFields(draft);
  let offerId: string;
  try {
    offerId = await prisma.$transaction(async (tx) => {
      const offer = await tx.offer.create({
        data: { ...fields, isPublic: false, source: "user", createdByUserId: user.id, publishedAt: null },
      });
      await syncOfferLinks(tx, offer.id, fields);
      return offer.id;
    });
  } catch (error) {
    if (isUrlConflict(error)) {
      const existing = await prisma.offer.findUniqueOrThrow({ where: { url: fields.url! }, select: { id: true } });
      throw offerExists(existing.id);
    }
    throw error;
  }

  // Added offers are saved automatically (O5); a full saved list doesn't block it.
  try {
    await saveOffer(user, offerId);
  } catch (error) {
    if (!(error instanceof HttpError && error.code === "limit_reached")) throw error;
  }
  return getOfferDetail(offerId, user.id, undefined);
}

// The creator may edit their private offer; public offers are read-only (O5).
export async function updateUserOffer(userId: string, offerId: string, draft: OfferDraft): Promise<OfferDetail> {
  const offer = await prisma.offer.findFirst({ where: { id: offerId, createdByUserId: userId }, select: { isPublic: true } });
  if (!offer) throw new HttpError(404, "offer_not_found", "Offer not found");
  if (offer.isPublic) throw new HttpError(403, "offer_read_only", "This offer is public and can no longer be edited");
  await checkLocation(draft.locationId);

  const fields = offerFields(draft);
  try {
    await prisma.$transaction(async (tx) => {
      await tx.offer.update({ where: { id: offerId }, data: fields });
      await syncOfferLinks(tx, offerId, fields);
    });
  } catch (error) {
    if (isUrlConflict(error)) {
      const existing = await prisma.offer.findUniqueOrThrow({ where: { url: fields.url! }, select: { id: true } });
      throw offerExists(existing.id);
    }
    throw error;
  }
  return getOfferDetail(offerId, userId, undefined);
}
