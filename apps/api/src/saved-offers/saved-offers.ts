import { Prisma, type SavedOffer } from "@prisma/client";
import type { SavedOfferInfo, SavedOfferListResponse, SavedOfferStatus } from "@job/shared";
import { config } from "../config";
import { HttpError } from "../lib/http-error";
import { prisma } from "../lib/prisma";
import { toLocationSummary, toSalary, visibleOfferWhere } from "../offers/offer-access";

// Saved offers with application tracking (FEATURE O3).

export function toSavedOfferInfo(saved: SavedOffer): SavedOfferInfo {
  return {
    status: saved.status,
    notes: saved.notes,
    appliedAt: saved.appliedAt?.toISOString() ?? null,
    statusChangedAt: saved.statusChangedAt.toISOString(),
    savedAt: saved.createdAt.toISOString(),
  };
}

const notFound = () => new HttpError(404, "saved_offer_not_found", "This offer is not in your saved offers");

export async function listSavedOffers(
  userId: string,
  filter: { status?: SavedOfferStatus; sort: "saved" | "status_changed" },
): Promise<SavedOfferListResponse> {
  const rows = await prisma.savedOffer.findMany({
    where: { userId, ...(filter.status && { status: filter.status }) },
    include: { offer: { include: { location: true } } },
    orderBy: [filter.sort === "saved" ? { createdAt: "desc" } : { statusChangedAt: "desc" }, { id: "asc" }],
  });

  return {
    results: rows.map((saved) => ({
      ...toSavedOfferInfo(saved),
      offer: {
        id: saved.offer.id,
        title: saved.offer.title,
        companyName: saved.offer.companyName,
        location: toLocationSummary(saved.offer.location),
        remoteType: saved.offer.remoteType,
        contractType: saved.offer.contractType,
        salary: toSalary(saved.offer),
        publishedAt: saved.offer.publishedAt?.toISOString() ?? null,
        closed: saved.offer.closedAt !== null,
      },
    })),
  };
}

// Idempotent: saving an offer twice returns the existing entry.
// `requireVisible: false` is for O5: a user who adds the URL of an existing offer gets it
// saved even if it was another user's private offer (they know the page already).
export async function saveOffer(
  user: { id: string; isGuest: boolean },
  offerId: string,
  { requireVisible = true }: { requireVisible?: boolean } = {},
): Promise<{ created: boolean; saved: SavedOfferInfo }> {
  const existing = await prisma.savedOffer.findUnique({ where: { userId_offerId: { userId: user.id, offerId } } });
  if (existing) return { created: false, saved: toSavedOfferInfo(existing) };

  const where = requireVisible ? { id: offerId, ...visibleOfferWhere(user.id) } : { id: offerId };
  const offer = await prisma.offer.findFirst({ where, select: { id: true } });
  if (!offer) throw new HttpError(404, "offer_not_found", "Offer not found");

  const limit = user.isGuest ? config.limits.savedOffers.guest : config.limits.savedOffers.registered;
  if ((await prisma.savedOffer.count({ where: { userId: user.id } })) >= limit) {
    throw new HttpError(429, "limit_reached", `You can save at most ${limit} offers`);
  }

  try {
    const saved = await prisma.savedOffer.create({ data: { userId: user.id, offerId } });
    return { created: true, saved: toSavedOfferInfo(saved) };
  } catch (error) {
    // Double submit: the other request created it.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const saved = await prisma.savedOffer.findUniqueOrThrow({ where: { userId_offerId: { userId: user.id, offerId } } });
      return { created: false, saved: toSavedOfferInfo(saved) };
    }
    throw error;
  }
}

export async function updateSavedOffer(
  userId: string,
  offerId: string,
  input: { status?: SavedOfferStatus; notes?: string | null; appliedAt?: string | null },
): Promise<SavedOfferInfo> {
  const existing = await prisma.savedOffer.findUnique({ where: { userId_offerId: { userId, offerId } } });
  if (!existing) throw notFound();

  const data: Prisma.SavedOfferUpdateInput = {};
  if (input.notes !== undefined) data.notes = input.notes === "" ? null : input.notes;
  if (input.appliedAt !== undefined) data.appliedAt = input.appliedAt === null ? null : new Date(input.appliedAt);
  // Any transition is allowed; `applied_at` is set automatically the first time the
  // status becomes `applied`, unless the request sets it.
  if (input.status !== undefined && input.status !== existing.status) {
    data.status = input.status;
    data.statusChangedAt = new Date();
    if (input.status === "applied" && existing.appliedAt === null && input.appliedAt === undefined) {
      data.appliedAt = new Date();
    }
  }

  const saved = await prisma.savedOffer.update({ where: { id: existing.id }, data });
  return toSavedOfferInfo(saved);
}

export async function unsaveOffer(userId: string, offerId: string): Promise<void> {
  const { count } = await prisma.savedOffer.deleteMany({ where: { userId, offerId } });
  if (count === 0) throw notFound();
}
