import type { LocationSummary, OfferSearchResult } from "@job/shared";
import type { TFunction } from "i18next";

// Numbers, dates and places in the interface's language.

export function formatSalary(salary: OfferSearchResult["salary"], language: string, t: TFunction): string | null {
  if (!salary || (salary.min === null && salary.max === null)) return null;
  const yearly = salary.period === "year";
  const format = (value: number) =>
    new Intl.NumberFormat(language, {
      style: "currency",
      currency: salary.currency,
      maximumFractionDigits: yearly && value >= 1000 ? 0 : 2,
      notation: yearly && value >= 10_000 ? "compact" : "standard",
    }).format(value);
  const amount =
    salary.min !== null && salary.max !== null && salary.min !== salary.max
      ? `${format(salary.min)} – ${format(salary.max)}`
      : format((salary.min ?? salary.max)!);
  return `${amount} ${t(`offer.per.${salary.period}`)}`;
}

export function formatAge(iso: string | null, language: string): string | null {
  if (!iso) return null;
  const days = Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000);
  const format = new Intl.RelativeTimeFormat(language, { numeric: "auto" });
  if (days < 1) return format.format(0, "day");
  if (days < 30) return format.format(-days, "day");
  if (days < 365) return format.format(-Math.round(days / 30), "month");
  return format.format(-Math.round(days / 365), "year");
}

export function formatDate(iso: string, language: string): string {
  return new Intl.DateTimeFormat(language, { day: "numeric", month: "long", year: "numeric" }).format(new Date(iso));
}

// "Lyon", "Rhône", "Île-de-France", "France".
export function placeName(location: LocationSummary | null): string | null {
  return location?.name ?? null;
}

// Location with its context, for suggestions: "Lyon · Rhône", "Rhône · Auvergne-Rhône-Alpes".
export function placeContext(location: LocationSummary): string {
  return [location.type === "city" ? location.countyName : null, location.type !== "region" && location.type !== "country" ? location.regionName : null]
    .filter(Boolean)
    .join(" · ");
}
