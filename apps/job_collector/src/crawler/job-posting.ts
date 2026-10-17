import { parse } from "node-html-parser";
import type { CollectedOffer, ContractType, SalaryPeriod } from "@job/shared";
import { contractFrom, isFranceCountry, isoDate, mentionsFrance } from "../ats/mapping";

// schema.org JobPosting in JSON-LD (the markup read by Google for Jobs), and its mapping to
// the ingestion contract. Tolerant of the usual variants: one object, an array, an
// "@graph", "@type" as a list, values as text or objects.

type Json = Record<string, unknown>;
export type JobPosting = Json;

const asArray = <T>(value: T | T[] | null | undefined): T[] => (value == null ? [] : Array.isArray(value) ? value : [value]);
const isType = (node: Json, type: string) => asArray(node["@type"] as string | string[]).some((value) => String(value).toLowerCase() === type.toLowerCase());
const str = (value: unknown): string | null => {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number") return String(value);
  if (value && typeof value === "object") return str((value as Json).name ?? (value as Json)["@value"] ?? (value as Json).value);
  return null;
};

// Every JobPosting of a page.
export function extractJobPostings(html: string): JobPosting[] {
  const found: JobPosting[] = [];
  const visit = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== "object") return;
    const object = node as Json;
    if (isType(object, "JobPosting")) found.push(object);
    else if (object["@graph"]) visit(object["@graph"]);
  };
  for (const script of parse(html).querySelectorAll('script[type="application/ld+json"]')) {
    try {
      // Some sites put raw line breaks inside strings.
      visit(JSON.parse(script.rawText.replace(/[\u0000-\u001f]+/g, " ")));
    } catch {
      // Invalid JSON-LD: ignored.
    }
  }
  return found;
}

type Place = { city: string | null; postcode: string | null; region: string | null; country: string | null; latitude: number | null; longitude: number | null; raw: string | null };

function places(posting: JobPosting): Place[] {
  return asArray(posting.jobLocation as Json | Json[]).map((location) => {
    const address = (location?.address ?? {}) as Json;
    const geo = (location?.geo ?? {}) as Json;
    const number = (value: unknown) => (value != null && value !== "" && Number.isFinite(Number(value)) ? Number(value) : null);
    const city = str(address.addressLocality);
    const region = str(address.addressRegion);
    return {
      city,
      postcode: str(address.postalCode),
      region,
      country: str(address.addressCountry),
      latitude: number(geo.latitude),
      longitude: number(geo.longitude),
      raw: [str(address.streetAddress), city, region, str(address.addressCountry)].filter(Boolean).join(", ") || null,
    };
  });
}

const inFrance = (place: Place) =>
  isFranceCountry(place.country) || (!place.country && (mentionsFrance(place.city) || mentionsFrance(place.region) || /^\d{5}$/.test(place.postcode ?? "") && mentionsFrance(place.raw)));

const remoteOnly = (posting: JobPosting) => asArray(posting.jobLocationType as string | string[]).some((value) => /telecommute/i.test(String(value)));
const remoteFrance = (posting: JobPosting) =>
  asArray(posting.applicantLocationRequirements as Json | Json[]).some((requirement) => isFranceCountry(str(requirement?.name ?? requirement)) || mentionsFrance(str(requirement)));

// The French place of the offer, null when it isn't in France.
export function frenchPlace(posting: JobPosting): Place | "remote" | null {
  const place = places(posting).find(inFrance);
  if (place) return place;
  return remoteOnly(posting) && remoteFrance(posting) ? "remote" : null;
}

const CONTRACTS: Record<string, ContractType> = { INTERN: "internship", CONTRACTOR: "freelance", TEMPORARY: "temporary" };
const PERIODS: Record<string, SalaryPeriod> = { HOUR: "hour", DAY: "day", MONTH: "month", YEAR: "year" };

function salary(posting: JobPosting): CollectedOffer["salary"] {
  const base = posting.baseSalary as Json | undefined;
  if (!base || typeof base !== "object") return null;
  const currency = str(base.currency);
  const value = (base.value ?? {}) as Json;
  const amount = (key: string) => (value[key] != null && Number.isFinite(Number(value[key])) ? Number(value[key]) : null);
  const period = PERIODS[String(value.unitText ?? "").toUpperCase()];
  const min = amount("minValue") ?? amount("value");
  const max = amount("maxValue");
  if (!currency || !/^[A-Za-z]{3}$/.test(currency) || !period || (min === null && max === null)) return null;
  return { min, max, currency: currency.toUpperCase(), period };
}

// Some sites send the description as HTML written with entities ("&lt;p&gt;").
const decodeEntities = (html: string) => (/&lt;\/?[a-z]/i.test(html) ? parse(`<div>${html}</div>`).text : html);

export function jobPostingOffer(posting: JobPosting, page: { url: string; key: string; source: string; siteSlug: string; place: Place | "remote" }): CollectedOffer {
  const organization = (posting.hiringOrganization ?? {}) as Json;
  const employment = asArray(posting.employmentType as string | string[]).map(String);
  const explicit = employment.map((value) => CONTRACTS[value.toUpperCase()]).find(Boolean);
  const website = str(organization.sameAs) ?? str(organization.url);
  // Titles may carry entities ("stage 6 mois&nbsp; …").
  const title = parse(`<div>${str(posting.title) ?? ""}</div>`).text.replace(/\s+/g, " ").trim();
  const place = page.place;
  return {
    contractVersion: 1,
    source: page.source,
    externalId: `${page.siteSlug}:${page.key}`.slice(0, 200),
    url: page.url,
    applyUrl: null,
    title,
    company: str(organization.name) ? { name: str(organization.name)!, website: website && /^https?:\/\//.test(website) ? website : null } : null,
    location:
      place === "remote"
        ? { raw: "Remote, France", countryCode: "FR" }
        : { raw: place.raw, city: place.city, postcode: place.postcode, countryCode: "FR", latitude: place.latitude, longitude: place.longitude },
    remote: place === "remote" || remoteOnly(posting) ? "remote" : null,
    contractType: explicit ?? contractFrom(title, ...employment),
    salary: salary(posting),
    description: { format: "html", content: decodeEntities(str(posting.description) ?? "") || title },
    publishedAt: isoDate(str(posting.datePosted)),
    expiresAt: isoDate(str(posting.validThrough)),
    collectedAt: new Date().toISOString(),
  };
}
