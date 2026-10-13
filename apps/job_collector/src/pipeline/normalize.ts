import { htmlToMarkdown } from "@job/backend";
import { normalizeOfferUrl, type CollectedOffer, type ContractType, type RemoteType, type SalaryPeriod } from "@job/shared";
import { normalizeCompanyName, removePersonalData } from "./text";

// Stage 2 (COLLECTOR.md §6): contract → the values written to the database.

export class RejectedOffer extends Error {}

export type NormalizedOffer = {
  source: string;
  externalId: string;
  url: string | null;
  applyUrl: string | null;
  title: string;
  company: { name: string; normalizedName: string; siren: string | null; website: string | null } | null;
  location: NonNullable<CollectedOffer["location"]> | null;
  remote: RemoteType | null;
  contractType: ContractType | null;
  salary: { min: number | null; max: number | null; currency: string; period: SalaryPeriod } | null;
  description: string; // simplified Markdown, personal data removed
  language: string | null;
  occupations: { scheme: "rome" | "esco"; code: string }[];
  skillLabels: string[];
  publishedAt: Date | null;
  expiresAt: Date | null;
};

const MIN_DESCRIPTION = 30;

export function normalizeOffer(offer: CollectedOffer): NormalizedOffer {
  const title = offer.title.replace(/\s+/g, " ").trim();
  const markdown =
    offer.description.format === "html" ? htmlToMarkdown(offer.description.content) : offer.description.content.replace(/\r\n?/g, "\n").trim();
  const description = removePersonalData(markdown);
  if (description.length < MIN_DESCRIPTION) throw new RejectedOffer("description too short");

  const company = offer.company
    ? {
        name: offer.company.name.trim(),
        normalizedName: normalizeCompanyName(offer.company.name),
        siren: offer.company.siren ?? offer.company.siret?.slice(0, 9) ?? null,
        website: offer.company.website ?? null,
      }
    : null;

  let salary: NormalizedOffer["salary"] = null;
  if (offer.salary && (offer.salary.min != null || offer.salary.max != null)) {
    const min = offer.salary.min != null ? Math.round(offer.salary.min) : null;
    const max = offer.salary.max != null ? Math.round(offer.salary.max) : null;
    const [low, high] = min !== null && max !== null && min > max ? [max, min] : [min, max];
    salary = { min: low, max: high, currency: offer.salary.currency.toUpperCase(), period: offer.salary.period };
  }

  return {
    source: offer.source,
    externalId: offer.externalId,
    url: offer.url ? normalizeOfferUrl(offer.url) : null,
    applyUrl: offer.applyUrl ? normalizeOfferUrl(offer.applyUrl) : null,
    title,
    company: company && company.normalizedName ? company : null,
    location: offer.location ?? null,
    remote: offer.remote ?? null,
    contractType: offer.contractType ?? null,
    salary,
    description,
    language: offer.language?.toLowerCase().slice(0, 2) ?? null,
    occupations: (offer.occupations ?? []).map(({ scheme, code }) => ({ scheme, code: code.trim() })),
    skillLabels: (offer.skills ?? []).map((skill) => skill.label),
    publishedAt: offer.publishedAt ? new Date(offer.publishedAt) : null,
    expiresAt: offer.expiresAt ? new Date(offer.expiresAt) : null,
  };
}
