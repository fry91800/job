import { prisma, writeOfferLinks } from "@job/backend";
import { Prisma } from "@prisma/client";
import { sourcePriority } from "../connectors/registry";
import type { NormalizedOffer } from "./normalize";
import { qualityScore } from "./text";

// Stage 6 (COLLECTOR.md §6–7): write the offer and its source.

export type Enrichment = {
  companyId: string | null;
  locationId: number | null;
  fingerprint: string | null;
  language: string | null;
  occupationIds: number[];
  skillIds: number[];
};

type OfferFields = {
  title: string;
  companyName: string | null;
  description: string;
  language: string | null;
  locationId: number | null;
  remoteType: NormalizedOffer["remote"];
  contractType: NormalizedOffer["contractType"];
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryPeriod: NonNullable<NormalizedOffer["salary"]>["period"] | null;
  companyId: string | null;
  fingerprint: string | null;
  publishedAt: Date | null;
};

function fieldsOf(offer: NormalizedOffer, enrichment: Enrichment): OfferFields {
  return {
    title: offer.title,
    companyName: offer.company?.name ?? null,
    description: offer.description,
    language: enrichment.language,
    locationId: enrichment.locationId,
    remoteType: offer.remote,
    contractType: offer.contractType,
    salaryMin: offer.salary?.min ?? null,
    salaryMax: offer.salary?.max ?? null,
    salaryCurrency: offer.salary?.currency ?? null,
    salaryPeriod: offer.salary?.period ?? null,
    companyId: enrichment.companyId,
    fingerprint: enrichment.fingerprint,
    publishedAt: offer.publishedAt,
  };
}

function score(fields: OfferFields, skillCount: number): number {
  return qualityScore({
    hasSalary: fields.salaryMin !== null || fields.salaryMax !== null,
    hasLocation: fields.locationId !== null,
    hasContract: fields.contractType !== null,
    hasRemote: fields.remoteType !== null,
    hasCompany: fields.companyName !== null,
    skillCount,
    descriptionLength: fields.description.length,
    hasPublishedAt: fields.publishedAt !== null,
  });
}

const isUniqueViolation = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

async function writeSource(tx: Prisma.TransactionClient, offerId: string, offer: NormalizedOffer, now: Date) {
  await tx.offerSource.upsert({
    where: { source_externalId: { source: offer.source, externalId: offer.externalId } },
    create: { offerId, source: offer.source, externalId: offer.externalId, url: offer.url, applyUrl: offer.applyUrl, expiresAt: offer.expiresAt },
    update: { url: offer.url, applyUrl: offer.applyUrl, expiresAt: offer.expiresAt, lastSeenAt: now, closedAt: null },
  });
}

export async function createOffer(offer: NormalizedOffer, enrichment: Enrichment): Promise<string> {
  const fields = fieldsOf(offer, enrichment);
  const now = new Date();
  const create = (url: string | null) =>
    prisma.$transaction(async (tx) => {
      const created = await tx.offer.create({
        data: {
          ...fields,
          url,
          qualityScore: score(fields, enrichment.skillIds.length),
          isPublic: true,
          source: offer.source,
          externalId: offer.externalId,
          collectedAt: now,
          lastVerifiedAt: now,
        },
      });
      await writeSource(tx, created.id, offer, now);
      await writeOfferLinks(tx, created.id, { skillIds: enrichment.skillIds, occupationIds: enrichment.occupationIds });
      return created.id;
    });
  try {
    return await create(offer.url);
  } catch (error) {
    // The URL already belongs to another offer: kept on this offer's source only.
    if (isUniqueViolation(error) && offer.url) return create(null);
    throw error;
  }
}

// Updates an existing offer with a record of one of its sources (same source) or of a
// new source (merge). The source with the highest priority provides the fields; others
// only fill the empty ones.
export async function updateOffer(offerId: string, offer: NormalizedOffer, enrichment: Enrichment): Promise<void> {
  const current = await prisma.offer.findUniqueOrThrow({
    where: { id: offerId },
    include: { skills: { select: { skillId: true } }, occupations: { select: { occupationId: true } } },
  });
  const incoming = fieldsOf(offer, enrichment);
  const isMainSource = current.source === offer.source && current.externalId === offer.externalId;
  const takesOver = !isMainSource && sourcePriority(offer.source) > sourcePriority(current.source);

  const merged = { ...incoming } as Record<keyof OfferFields, unknown>;
  if (!isMainSource && !takesOver) {
    for (const key of Object.keys(incoming) as (keyof OfferFields)[]) {
      const existing = (current as unknown as Record<string, unknown>)[key];
      merged[key] = existing ?? incoming[key];
    }
    // The salary is one group (amounts, currency, period): never mixed across sources.
    const currentHasSalary = current.salaryMin !== null || current.salaryMax !== null;
    for (const key of ["salaryMin", "salaryMax", "salaryCurrency", "salaryPeriod"] as const) {
      merged[key] = currentHasSalary ? current[key] : incoming[key];
    }
  }
  const fields = merged as OfferFields;
  const skillIds = [...new Set([...(isMainSource || takesOver ? [] : current.skills.map((row) => row.skillId)), ...enrichment.skillIds])];
  const occupationIds = [...new Set([...(isMainSource || takesOver ? [] : current.occupations.map((row) => row.occupationId)), ...enrichment.occupationIds])];
  const now = new Date();

  const write = (url: string | null | undefined) =>
    prisma.$transaction(async (tx) => {
      await tx.offer.update({
        where: { id: offerId },
        data: {
          ...fields,
          qualityScore: score(fields, skillIds.length),
          lastVerifiedAt: now,
          closedAt: null, // a source still publishes it
          // A private user-added offer found by a connector becomes public (FEATURE O5).
          isPublic: true,
          ...(takesOver && { source: offer.source, externalId: offer.externalId }),
          ...(url !== undefined && { url }),
        },
      });
      await writeSource(tx, offerId, offer, now);
      await writeOfferLinks(tx, offerId, { skillIds, occupationIds });
    });
  const newUrl = (isMainSource || takesOver || !current.url) && offer.url ? offer.url : undefined;
  try {
    await write(newUrl);
  } catch (error) {
    if (isUniqueViolation(error) && newUrl !== undefined) return write(undefined);
    throw error;
  }
}
