import type { Location, Offer, Prisma } from "@prisma/client";
import type { LocationSummary, OfferSearchResult } from "@job/shared";

// Offer visibility rule (DATABASE.md "offers"): public offers, plus the user's own
// user-added offers and offers the user saved or generated a resume for.
export function visibleOfferWhere(userId: string | undefined): Prisma.OfferWhereInput {
  if (!userId) return { isPublic: true };
  return {
    OR: [
      { isPublic: true },
      { createdByUserId: userId },
      { savedBy: { some: { userId } } },
      { generatedResumes: { some: { userId } } },
    ],
  };
}

export function toLocationSummary(location: Location | null): LocationSummary | null {
  if (!location) return null;
  return {
    id: location.id,
    type: location.type,
    name: location.name,
    countryCode: location.countryCode,
    regionName: location.regionName,
    countyName: location.countyName,
  };
}

export function toSalary(offer: Offer): OfferSearchResult["salary"] {
  if (!offer.salaryCurrency || !offer.salaryPeriod) return null;
  return { min: offer.salaryMin, max: offer.salaryMax, currency: offer.salaryCurrency, period: offer.salaryPeriod };
}
