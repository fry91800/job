import type { CollectedOffer } from "@job/shared";
import { collectorConfig } from "../../config";
import type { CollectedRecord } from "../../connectors/types";
import { crawlGet, PageGoneError } from "../../crawler/fetcher";
import type { AtsAdapter, PartialListing } from "../adapter";
import { NotFoundError } from "../http";
import { contractFrom, remoteFrom } from "../mapping";

// Amazon's careers site (www.amazon.jobs, COLLECTOR.md §17.20). Checked 2026-10-19:
// * robots.txt only forbids /internal;
// * the site's own search, /fr/search.json?normalized_country_code[]=FRA, lists the offers in
//   France (220) with their full texts (description, basic and preferred qualifications,
//   HTML), city and region, posted date ("octobre 19, 2026" in French), id_icims, job_path;
//   100 offers a page (offset).
// No page per offer is needed: the list is complete, offers missing from it are closed.

const SOURCE = "amazon";
const PAGE_SIZE = 100;

type AmazonJob = {
  id_icims?: string;
  title?: string;
  company_name?: string;
  city?: string | null;
  normalized_location?: string | null;
  country_code?: string;
  description?: string;
  basic_qualifications?: string;
  preferred_qualifications?: string;
  posted_date?: string;
  job_path?: string;
  job_schedule_type?: string | null;
  is_intern?: boolean | null;
  url_next_step?: string;
};

const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const ENGLISH_MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

// "octobre 19, 2026" (or "October 19, 2026") → ISO.
export function amazonDate(value: string | undefined): string | null {
  const match = /^(\p{L}+)\s+(\d{1,2}),\s*(\d{4})$/u.exec((value ?? "").trim());
  if (!match) return null;
  const name = match[1].toLowerCase();
  const month = Math.max(MONTHS.indexOf(name), ENGLISH_MONTHS.indexOf(name));
  return month < 0 ? null : `${match[3]}-${String(month + 1).padStart(2, "0")}-${match[2].padStart(2, "0")}T00:00:00.000Z`;
}

export function amazonDescription(job: AmazonJob): string {
  const parts: [string | null, string | undefined][] = [
    [null, job.description],
    ["Qualifications requises", job.basic_qualifications],
    ["Qualifications appréciées", job.preferred_qualifications],
  ];
  return parts
    .filter(([, text]) => text?.trim())
    .map(([label, text]) => `${label ? `<h3>${label}</h3>` : ""}<p>${text!.trim()}</p>`)
    .join("");
}

export function amazonOffer(slug: string, companyName: string, job: AmazonJob): CollectedOffer {
  const url = `${collectorConfig.crawler.scheme}://${slug}${job.job_path ?? `/fr/jobs/${job.id_icims}`}`;
  return {
    contractVersion: 1,
    source: SOURCE,
    externalId: `${slug}:${job.id_icims}`,
    url,
    applyUrl: job.url_next_step && /^https:\/\//.test(job.url_next_step) ? job.url_next_step : null,
    title: job.title!,
    company: { name: companyName, atsSlug: slug },
    location: { raw: job.normalized_location ?? job.city ?? null, city: job.city ?? null, countryCode: "FR" },
    remote: remoteFrom(job.title),
    contractType: job.is_intern ? "internship" : contractFrom(job.title, job.description?.slice(0, 400)),
    description: { format: "html", content: amazonDescription(job) || job.title! },
    publishedAt: amazonDate(job.posted_date),
    collectedAt: new Date().toISOString(),
  };
}

async function allJobs(slug: string): Promise<{ jobs: AmazonJob[]; total: number }> {
  const jobs = new Map<string, AmazonJob>();
  let total = Infinity;
  for (let offset = 0; offset < total && offset < PAGE_SIZE * collectorConfig.amazon.maxListPages; ) {
    let text: string;
    try {
      text = (await crawlGet(`${collectorConfig.crawler.scheme}://${slug}/fr/search.json?normalized_country_code%5B%5D=FRA&result_limit=${PAGE_SIZE}&offset=${offset}&sort=recent`, { accept: "application/json" })).text;
    } catch (error) {
      if (error instanceof PageGoneError) throw new NotFoundError(error.message);
      throw error;
    }
    const page = JSON.parse(text) as { hits?: number; jobs?: AmazonJob[] };
    total = page.hits ?? 0;
    const items = page.jobs ?? [];
    if (!items.length) break;
    for (const job of items) if (job.id_icims && job.title && job.country_code === "FRA") jobs.set(job.id_icims, job);
    offset += items.length;
  }
  return { jobs: [...jobs.values()], total: Number.isFinite(total) ? total : 0 };
}

export const amazon: AtsAdapter = {
  ats: SOURCE,
  kind: "crawler",
  schedule: "15 6 * * *", // daily, like the career sites

  async check(slug) {
    const { jobs, total } = await allJobs(slug);
    return { companyName: "Amazon", jobCount: total, franceJobCount: jobs.length };
  },

  async *collect(slug, companyName): AsyncGenerator<CollectedRecord | PartialListing> {
    const { jobs, total } = await allJobs(slug);
    // A listing cut short closes nothing.
    if (jobs.length < total * 0.98) yield { partialListing: true };
    for (const job of jobs) {
      // The employing company ("Amazon France Logistique SAS") stays in the raw record; offers
      // are shown under the board's company.
      const offer = amazonOffer(slug, companyName, job);
      yield { raw: { url: offer.url, releasedDate: job.posted_date ?? null, job }, offer };
    }
  },
};
