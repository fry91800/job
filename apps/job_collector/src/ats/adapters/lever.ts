import type { CollectedOffer, RemoteType } from "@job/shared";
import { collectorConfig } from "../../config";
import { firstPathSegment, type AtsAdapter } from "../adapter";
import { fetchJson } from "../http";
import { contractFrom, frenchCity, isFranceCountry, isoDate, mentionsFrance, remoteFrom, salaryPeriod } from "../mapping";

type Job = {
  id: string;
  text: string;
  hostedUrl: string;
  applyUrl?: string;
  createdAt?: number;
  country?: string | null;
  workplaceType?: string;
  categories?: { commitment?: string; location?: string; allLocations?: string[] };
  opening?: string;
  description?: string;
  lists?: { text?: string; content?: string }[];
  additional?: string;
  salaryRange?: { min?: number; max?: number; currency?: string; interval?: string } | null;
};

const WORKPLACE: Record<string, RemoteType> = { remote: "remote", hybrid: "hybrid", "on-site": "onsite", onsite: "onsite" };
const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Lever has a US and an EU instance: two adapters, same code.
function makeLever(ats: "lever" | "lever-eu", prefixes: string[]): AtsAdapter {
  const base = () => collectorConfig.ats.baseUrls[ats];
  const jobsOf = (slug: string) => fetchJson<Job[]>(`${base()}/v0/postings/${encodeURIComponent(slug)}?mode=json`);
  const inFrance = (job: Job) =>
    isFranceCountry(job.country) || mentionsFrance(job.categories?.location) || (job.categories?.allLocations ?? []).some(mentionsFrance);

  const toOffer = (job: Job, slug: string, companyName: string): CollectedOffer => {
    const location = job.categories?.location ?? null;
    const lists = (job.lists ?? []).map((list) => `<h3>${escape(list.text ?? "")}</h3><ul>${list.content ?? ""}</ul>`).join("");
    const period = salaryPeriod(job.salaryRange?.interval);
    return {
      contractVersion: 1,
      source: ats,
      externalId: `${slug}:${job.id}`,
      url: job.hostedUrl,
      applyUrl: job.applyUrl ?? null,
      title: job.text,
      company: { name: companyName, atsSlug: slug },
      location: { raw: location, city: frenchCity(location), countryCode: "FR" },
      remote: (job.workplaceType && WORKPLACE[job.workplaceType]) || remoteFrom(location, job.text),
      contractType: contractFrom(job.text, job.categories?.commitment),
      salary:
        job.salaryRange?.currency && period ? { min: job.salaryRange.min ?? null, max: job.salaryRange.max ?? null, currency: job.salaryRange.currency, period } : null,
      description: { format: "html", content: [job.opening, job.description, lists, job.additional].filter(Boolean).join("\n") || job.text },
      publishedAt: isoDate(job.createdAt),
      collectedAt: new Date().toISOString(),
    };
  };

  return {
    ats,
    discovery: { prefixes, slugFromUrl: firstPathSegment },
    async check(slug) {
      const jobs = await jobsOf(slug);
      return { companyName: null, jobCount: jobs.length, franceJobCount: jobs.filter(inFrance).length };
    },
    async *collect(slug, companyName) {
      for (const job of (await jobsOf(slug)).filter(inFrance)) yield { raw: job, offer: toOffer(job, slug, companyName) };
    },
  };
}

export const lever = makeLever("lever", ["jobs.lever.co/"]);
export const leverEu = makeLever("lever-eu", ["jobs.eu.lever.co/"]);
