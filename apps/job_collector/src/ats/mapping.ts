import type { ContractType, RemoteType, SalaryPeriod } from "@job/shared";
import { stripAccents } from "../pipeline/text";

// Mapping helpers shared by the ATS adapters. Values are only set from explicit signals:
// "Full time" alone doesn't tell whether a contract is permanent.

const FRENCH_PLACES = [
  "france", "ile-de-france", "ile de france", "paris", "la defense", "boulogne-billancourt", "issy-les-moulineaux",
  "levallois-perret", "courbevoie", "nanterre", "neuilly-sur-seine", "saint-denis", "montrouge", "massy", "saclay",
  "palaiseau", "lyon", "villeurbanne", "marseille", "aix-en-provence", "toulouse", "nice", "sophia antipolis", "valbonne",
  "nantes", "strasbourg", "montpellier", "bordeaux", "lille", "rennes", "reims", "grenoble", "nancy", "metz", "rouen",
  "tours", "clermont-ferrand", "brest", "le mans", "dijon", "angers", "annecy", "orleans", "caen", "limoges", "poitiers",
  "pau", "amiens", "besancon", "saint-etienne", "toulon", "mulhouse", "perpignan", "la rochelle", "biarritz",
];
const PLACE_PATTERN = new RegExp(`(^|[^a-z])(${FRENCH_PLACES.map((place) => place.replace(/[-\s]/g, "[-\\s]")).join("|")})([^a-z]|$)`);

const plain = (text: string) => stripAccents(text).toLowerCase();

// Does a location text point to France ("Paris, France", "Remote - France", "Lyon")?
export function mentionsFrance(text: string | null | undefined): boolean {
  return !!text && PLACE_PATTERN.test(plain(text));
}

// The French city named in a location text, as written in the list above (title case
// is restored by the pipeline's location lookup, which ignores case and accents).
export function frenchCity(text: string | null | undefined): string | null {
  if (!text) return null;
  const match = PLACE_PATTERN.exec(plain(text));
  const place = match?.[2];
  return place && !["france", "ile-de-france", "ile de france"].includes(place) ? place : null;
}

export function isFranceCountry(value: string | null | undefined): boolean {
  return !!value && ["fr", "fra", "france"].includes(plain(value).trim());
}

// Contract type from explicit words (title, commitment, employment type).
export function contractFrom(...texts: (string | null | undefined)[]): ContractType | null {
  const text = plain(texts.filter(Boolean).join(" | "));
  if (/\b(alternance|alternant|apprenti|apprenticeship|work[-\s]study)\b/.test(text)) return "apprenticeship";
  if (/\b(stage|stagiaire|internship|intern|interne)\b/.test(text)) return "internship";
  if (/\bcdd\b|fixed[-\s]term/.test(text)) return "fixed_term";
  if (/\b(freelance|freelancer|independant|contractor)\b/.test(text)) return "freelance";
  if (/\b(interim|temporary)\b/.test(text)) return "temporary";
  if (/\bcdi\b|permanent/.test(text)) return "permanent";
  return null;
}

export function remoteFrom(...texts: (string | null | undefined)[]): RemoteType | null {
  const text = plain(texts.filter(Boolean).join(" | "));
  if (/\bhybrid|hybride\b/.test(text)) return "hybrid";
  if (/\b(remote|full[-\s]remote|teletravail complet|100 ?% teletravail)\b/.test(text)) return "remote";
  if (/\b(on[-\s]?site|onsite|in[-\s]office|sur site)\b/.test(text)) return "onsite";
  return null;
}

// "per-year-salary", "1 YEAR", "YEAR"… → period.
export function salaryPeriod(interval: string | null | undefined): SalaryPeriod | null {
  const text = plain(interval ?? "");
  if (/year|annual|annuel/.test(text)) return "year";
  if (/month|mensuel/.test(text)) return "month";
  if (/day|daily|jour/.test(text)) return "day";
  if (/hour|hourly|heure/.test(text)) return "hour";
  return null;
}

// "my-company" → "My Company" (boards that don't give their company's name).
export function nameFromSlug(slug: string): string {
  return decodeURIComponent(slug)
    .replace(/[-_.]+/g, " ")
    .replace(/\b\p{L}/gu, (letter) => letter.toUpperCase())
    .trim();
}

export function isoDate(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
