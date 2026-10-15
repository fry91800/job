import type { CollectedOffer, ContractType } from "@job/shared";
import { collectorConfig } from "../../config";
import type { AtsAdapter } from "../adapter";
import { fetchJson } from "../http";
import { contractFrom, isFranceCountry, isoDate, salaryPeriod } from "../mapping";

// Recruitee's public careers API: {company}.recruitee.com/api/offers/, every published
// offer with its description, locations and sometimes a salary.

type Location = { country_code?: string; country?: string; city?: string; state?: string; name?: string; postal_code?: string };
type Offer = {
  id: number;
  slug: string;
  title: string;
  careers_url?: string;
  careers_apply_url?: string;
  location?: string;
  locations?: Location[];
  country_code?: string;
  city?: string;
  remote?: boolean;
  hybrid?: boolean;
  employment_type_code?: string;
  description?: string;
  requirements?: string | null;
  published_at?: string;
  company_name?: string;
  salary?: { min?: string | number | null; max?: string | number | null; period?: string; currency?: string } | null;
};

// Per-company host: the base URL is a template.
const base = (slug: string) => collectorConfig.ats.baseUrls.recruitee.replace("{slug}", encodeURIComponent(slug));
const offersOf = async (slug: string) => (await fetchJson<{ offers: Offer[] }>(`${base(slug)}/api/offers/`)).offers;

const frenchLocation = (offer: Offer): Location | null =>
  (offer.locations ?? []).find((location) => isFranceCountry(location.country_code) || isFranceCountry(location.country)) ??
  (isFranceCountry(offer.country_code) ? { city: offer.city, name: offer.location } : null);

const EMPLOYMENT: Record<string, ContractType> = {
  fulltime_permanent: "permanent",
  parttime_permanent: "permanent",
  fulltime_fixed_term: "fixed_term",
  parttime_fixed_term: "fixed_term",
  internship: "internship",
  freelance: "freelance",
  traineeship: "internship",
  apprenticeship: "apprenticeship",
  temporary: "temporary",
};

const amount = (value: string | number | null | undefined) => (value != null && value !== "" && Number.isFinite(Number(value)) ? Number(value) : null);

export function recruiteeOffer(offer: Offer, slug: string, companyName: string): CollectedOffer {
  const location = frenchLocation(offer);
  const period = salaryPeriod(offer.salary?.period);
  const min = amount(offer.salary?.min);
  const max = amount(offer.salary?.max);
  const currency = offer.salary?.currency;
  return {
    contractVersion: 1,
    source: "recruitee",
    externalId: `${slug}:${offer.id}`,
    url: offer.careers_url ?? null,
    applyUrl: offer.careers_apply_url ?? null,
    title: offer.title,
    company: { name: offer.company_name?.trim() || companyName, atsSlug: slug },
    location: { raw: location?.name ?? offer.location ?? null, city: location?.city ?? null, postcode: location?.postal_code ?? null, countryCode: "FR" },
    remote: offer.remote ? "remote" : offer.hybrid ? "hybrid" : null,
    contractType: (offer.employment_type_code && EMPLOYMENT[offer.employment_type_code]) || contractFrom(offer.title),
    salary: period && currency && /^[A-Za-z]{3}$/.test(currency) && (min !== null || max !== null) ? { min, max, currency: currency.toUpperCase(), period } : null,
    description: { format: "html", content: [offer.description, offer.requirements].filter(Boolean).join("\n") || offer.title },
    publishedAt: isoDate(offer.published_at?.replace(" UTC", "Z").replace(" ", "T")),
    collectedAt: new Date().toISOString(),
  };
}

// {company}.recruitee.com, but not Recruitee's own hosts.
const NOT_COMPANIES = new Set(["www", "app", "api", "help", "blog", "careers", "status", "support", "docs", "partners"]);

export const recruitee: AtsAdapter = {
  ats: "recruitee",
  discovery: {
    prefixes: ["recruitee.com"],
    matchType: "domain",
    slugFromUrl: (url) => {
      const [sub, ...rest] = url.hostname.toLowerCase().split(".");
      return rest.join(".") === "recruitee.com" && /^[a-z0-9][a-z0-9-]{0,62}$/.test(sub) && !NOT_COMPANIES.has(sub) ? sub : null;
    },
  },
  async check(slug) {
    const offers = await offersOf(slug);
    return { companyName: offers[0]?.company_name?.trim() || null, jobCount: offers.length, franceJobCount: offers.filter(frenchLocation).length };
  },
  async *collect(slug, companyName) {
    for (const offer of (await offersOf(slug)).filter(frenchLocation)) yield { raw: offer, offer: recruiteeOffer(offer, slug, companyName) };
  },
};
