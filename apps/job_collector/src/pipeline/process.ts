import { prisma } from "@job/backend";
import { collectedOfferSchema } from "@job/shared";
import type { CollectedRecord } from "../connectors/types";
import { findOrCreateCompany } from "./companies";
import { findDuplicate } from "./dedupe";
import { resolveLanguage, resolveLocation, resolveOccupations, resolveSkills } from "./enrich";
import { normalizeOffer, RejectedOffer } from "./normalize";
import { storeRaw } from "./raw";
import { offerFingerprint } from "./text";
import { createOffer, updateOffer } from "./upsert";

// One record through the whole pipeline (COLLECTOR.md §6).

export type Outcome =
  | { result: "created" | "updated" | "merged" | "unchanged"; offerId: string }
  | { result: "rejected"; reason: string };

export async function processRecord(record: CollectedRecord): Promise<Outcome> {
  // Validate the contract.
  const parsed = collectedOfferSchema.safeParse(record.offer);
  if (!parsed.success) {
    return { result: "rejected", reason: parsed.error.issues.slice(0, 3).map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ") };
  }
  const contract = parsed.data;

  // 1. Raw data; unchanged records only mark their source as seen.
  const { changed } = await storeRaw(contract.source, contract.externalId, record.raw);
  if (!changed) {
    const known = await prisma.offerSource.findUnique({ where: { source_externalId: { source: contract.source, externalId: contract.externalId } } });
    if (known) {
      await prisma.offerSource.update({ where: { id: known.id }, data: { lastSeenAt: new Date(), closedAt: null } });
      await prisma.offer.updateMany({ where: { id: known.offerId, closedAt: { not: null } }, data: { closedAt: null } });
      return { result: "unchanged", offerId: known.offerId };
    }
  }

  // 2–3. Normalize and validate.
  let offer;
  try {
    offer = normalizeOffer(contract);
  } catch (error) {
    if (error instanceof RejectedOffer) return { result: "rejected", reason: error.message };
    throw error;
  }

  // Company and location are needed for the fingerprint.
  const company = offer.company ? await findOrCreateCompany(offer.company) : null;
  const location = await resolveLocation(offer.location);
  const fingerprint = offerFingerprint(company?.key ?? null, offer.title, location.countyCode);

  // 4. Deduplicate.
  const duplicate = await findDuplicate(offer, fingerprint);

  // 5. Enrich.
  const language = resolveLanguage(offer);
  const [occupationIds, skillIds] = await Promise.all([resolveOccupations(offer, language), resolveSkills(offer, language)]);
  const enrichment = { companyId: company?.id ?? null, locationId: location.id, fingerprint, language, occupationIds, skillIds };

  // 6. Upsert.
  if (!duplicate) return { result: "created", offerId: await createOffer(offer, enrichment) };
  await updateOffer(duplicate.offerId, offer, enrichment);
  return { result: duplicate.rule === "same-source" ? "updated" : "merged", offerId: duplicate.offerId };
}
