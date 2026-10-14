import type { CollectedOffer, RemoteType } from "@job/shared";
import { collectorConfig } from "../../config";
import { firstPathSegment, type AtsAdapter } from "../adapter";
import { fetchJson } from "../http";
import { contractFrom, frenchCity, isFranceCountry, isoDate, mentionsFrance, remoteFrom, salaryPeriod } from "../mapping";

type Address = { postalAddress?: { addressLocality?: string; addressRegion?: string; addressCountry?: string } };
type Job = {
  id: string;
  title: string;
  employmentType?: string;
  location?: string;
  secondaryLocations?: { location?: string; address?: Address }[];
  publishedAt?: string;
  isListed?: boolean;
  isRemote?: boolean | null;
  workplaceType?: string | null;
  address?: Address;
  jobUrl: string;
  applyUrl?: string;
  descriptionHtml?: string;
  compensation?: { summaryComponents?: { compensationType?: string; interval?: string; currencyCode?: string; minValue?: number | null; maxValue?: number | null }[] };
};

const base = () => collectorConfig.ats.baseUrls.ashby;
const jobsOf = async (slug: string) =>
  (await fetchJson<{ jobs: Job[] }>(`${base()}/posting-api/job-board/${encodeURIComponent(slug)}?includeCompensation=true`)).jobs.filter(
    (job) => job.isListed !== false,
  );

const inFrance = (job: Job) =>
  isFranceCountry(job.address?.postalAddress?.addressCountry) ||
  mentionsFrance(job.location) ||
  (job.secondaryLocations ?? []).some((item) => mentionsFrance(item.location) || isFranceCountry(item.address?.postalAddress?.addressCountry));

const WORKPLACE: Record<string, RemoteType> = { remote: "remote", hybrid: "hybrid", onsite: "onsite" };

export function ashbyOffer(job: Job, slug: string, companyName: string): CollectedOffer {
  const address = isFranceCountry(job.address?.postalAddress?.addressCountry) ? job.address?.postalAddress : undefined;
  const salary = job.compensation?.summaryComponents?.find((item) => item.compensationType === "Salary" && item.currencyCode);
  const period = salaryPeriod(salary?.interval);
  const employment = job.employmentType === "Intern" ? "internship" : job.employmentType === "Temporary" ? "temporary" : null;
  return {
    contractVersion: 1,
    source: "ashby",
    externalId: `${slug}:${job.id}`,
    url: job.jobUrl,
    applyUrl: job.applyUrl ?? null,
    title: job.title,
    company: { name: companyName, atsSlug: slug },
    location: { raw: job.location ?? null, city: address?.addressLocality ?? frenchCity(job.location), countryCode: "FR" },
    remote: (job.workplaceType && WORKPLACE[job.workplaceType.toLowerCase()]) || (job.isRemote ? "remote" : remoteFrom(job.location)),
    contractType: contractFrom(job.title, employment),
    salary: salary && period ? { min: salary.minValue ?? null, max: salary.maxValue ?? null, currency: salary.currencyCode!, period } : null,
    description: { format: "html", content: job.descriptionHtml || job.title },
    publishedAt: isoDate(job.publishedAt),
    collectedAt: new Date().toISOString(),
  };
}

export const ashby: AtsAdapter = {
  ats: "ashby",
  discovery: { prefixes: ["jobs.ashbyhq.com/"], slugFromUrl: firstPathSegment },
  async check(slug) {
    const jobs = await jobsOf(slug);
    return { companyName: null, jobCount: jobs.length, franceJobCount: jobs.filter(inFrance).length };
  },
  async *collect(slug, companyName) {
    for (const job of (await jobsOf(slug)).filter(inFrance)) yield { raw: job, offer: ashbyOffer(job, slug, companyName) };
  },
};
