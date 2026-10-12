import type { OfferDetail, UiLanguage } from "@job/shared";
import { HttpError } from "../lib/http-error";
import { prisma } from "../lib/prisma";
import { toSavedOfferInfo } from "../saved-offers/saved-offers";
import { toLocationSummary, toSalary, visibleOfferWhere } from "./offer-access";

const canonicalNames = { where: { isCanonical: true }, select: { language: true, name: true } } as const;

// Canonical name in the requested language, else in any language.
function pickName(names: { language: string; name: string }[], language: UiLanguage): string {
  return (names.find((name) => name.language === language) ?? names[0])?.name ?? "";
}

// FEATURE O2. Closed offers stay viewable (the web app shows a banner); offers the user
// cannot see return 404.
export async function getOfferDetail(offerId: string, userId: string | undefined, lang: UiLanguage | undefined): Promise<OfferDetail> {
  const offer = await prisma.offer.findFirst({
    where: { id: offerId, ...visibleOfferWhere(userId) },
    include: {
      location: true,
      skills: { select: { skill: { select: { id: true, names: canonicalNames } } } },
      occupations: { select: { occupation: { select: { id: true, names: canonicalNames } } } },
    },
  });
  if (!offer) throw new HttpError(404, "offer_not_found", "Offer not found");

  const [user, saved, generatedResumes] = userId
    ? await Promise.all([
        prisma.user.findUnique({ where: { id: userId }, select: { uiLanguage: true } }),
        prisma.savedOffer.findUnique({ where: { userId_offerId: { userId, offerId } } }),
        prisma.generatedResume.findMany({
          where: { userId, offerId, deletedAt: null },
          select: { id: true, language: true, matchScore: true, createdAt: true },
          orderBy: { createdAt: "desc" },
        }),
      ])
    : [null, null, []];
  const language = lang ?? (user?.uiLanguage as UiLanguage | undefined) ?? "fr";

  return {
    id: offer.id,
    title: offer.title,
    companyName: offer.companyName,
    description: offer.description,
    language: offer.language,
    url: offer.url,
    location: toLocationSummary(offer.location),
    remoteType: offer.remoteType,
    contractType: offer.contractType,
    salary: toSalary(offer),
    publishedAt: offer.publishedAt?.toISOString() ?? null,
    closedAt: offer.closedAt?.toISOString() ?? null,
    isPublic: offer.isPublic,
    isOwn: userId !== undefined && offer.createdByUserId === userId,
    skills: offer.skills.map(({ skill }) => ({ id: skill.id, name: pickName(skill.names, language) })),
    occupations: offer.occupations.map(({ occupation }) => ({ id: occupation.id, name: pickName(occupation.names, language) })),
    saved: saved && toSavedOfferInfo(saved),
    generatedResumes: generatedResumes.map((item) => ({ ...item, createdAt: item.createdAt.toISOString() })),
  };
}
