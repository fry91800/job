import type { CollectedOffer } from "@job/shared";
import { collectorConfig } from "../../config";
import { firstPathSegment, type AtsAdapter } from "../adapter";
import { fetchJson } from "../http";
import { contractFrom, frenchCity, isFranceCountry, isoDate, mentionsFrance, remoteFrom } from "../mapping";

// Workable's public job widget API: every published offer of an account, with its
// description (`details=true`).

type Location = { country?: string; countryCode?: string; city?: string; region?: string };
type Job = {
  title: string;
  shortcode: string;
  employment_type?: string;
  telecommuting?: boolean;
  url?: string;
  shortlink?: string;
  application_url?: string;
  published_on?: string;
  created_at?: string;
  country?: string;
  city?: string;
  state?: string;
  locations?: Location[];
  description?: string;
};

const base = () => collectorConfig.ats.baseUrls.workable;
const jobsOf = async (slug: string) => fetchJson<{ name?: string; jobs: Job[] }>(`${base()}/api/v1/widget/accounts/${encodeURIComponent(slug)}?details=true`);

const frenchLocation = (job: Job): Location | null =>
  (job.locations ?? []).find((location) => isFranceCountry(location.countryCode) || isFranceCountry(location.country)) ??
  (isFranceCountry(job.country) || mentionsFrance(job.city) ? { country: job.country, city: job.city, region: job.state } : null);

const EMPLOYMENT: Record<string, "internship" | "temporary" | "freelance"> = { internship: "internship", temporary: "temporary", contract: "freelance" };

export function workableOffer(job: Job, slug: string, companyName: string): CollectedOffer {
  const location = frenchLocation(job);
  const raw = [location?.city, location?.region, location?.country].filter(Boolean).join(", ") || null;
  return {
    contractVersion: 1,
    source: "workable",
    externalId: `${slug}:${job.shortcode}`,
    url: job.url ?? job.shortlink ?? `https://apply.workable.com/${slug}/j/${job.shortcode}/`,
    applyUrl: job.application_url ?? null,
    title: job.title,
    company: { name: companyName, atsSlug: slug },
    location: { raw, city: location?.city || frenchCity(raw), countryCode: "FR" },
    remote: job.telecommuting ? "remote" : remoteFrom(job.title),
    contractType: contractFrom(job.title, EMPLOYMENT[(job.employment_type ?? "").toLowerCase()]),
    description: { format: "html", content: job.description || job.title },
    publishedAt: isoDate(job.published_on ?? job.created_at),
    collectedAt: new Date().toISOString(),
  };
}

// apply.workable.com/{account}/…, but not Workable's own pages.
const NOT_ACCOUNTS = new Set(["j", "api", "careers", "static"]);

export const workable: AtsAdapter = {
  ats: "workable",
  discovery: {
    prefixes: ["apply.workable.com/"],
    slugFromUrl: (url) => {
      const slug = firstPathSegment(url);
      return slug && !NOT_ACCOUNTS.has(slug.toLowerCase()) ? slug : null;
    },
  },
  async check(slug) {
    const { name, jobs } = await jobsOf(slug);
    return { companyName: name?.trim() || null, jobCount: jobs.length, franceJobCount: jobs.filter(frenchLocation).length };
  },
  async *collect(slug, companyName) {
    for (const job of (await jobsOf(slug)).jobs.filter(frenchLocation)) yield { raw: job, offer: workableOffer(job, slug, companyName) };
  },
};
