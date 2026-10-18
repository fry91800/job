import type { CollectedOffer } from "@job/shared";
import { collectorConfig } from "../../config";
import type { CollectedRecord } from "../../connectors/types";
import { CrawlError, crawlGet, PageGoneError } from "../../crawler/fetcher";
import { decodeEntities, extractJobPostings } from "../../crawler/job-posting";
import { refreshDue, type AtsAdapter, type PartialListing, type StillListed } from "../adapter";
import { NotFoundError } from "../http";
import { contractFrom, isoDate, remoteFrom } from "../mapping";
import { companyFromHost } from "./successfactors";

// Phenom career sites (careers.allianz.com, careers.dhl.com, orange.jobs,
// careers.thalesgroup.com), large employers (COLLECTOR.md §17.13). Board = host and the
// country/language section of the site: "careers.allianz.com/fr/fr". Checked 2026-10-18:
// * robots.txt closes */apply, */jobcart, */chatbot… and lists one sitemap per section;
// * the search page (/search-results) carries its results in the page, as JSON
//   (`phApp.ddo = {…}`, eagerLoadRefineSearch: totalHits, jobs with jobId, title, city,
//   country, location, postedDate, employmentType or contractType, remote or workModel), with
//   the site's filters: `qcountry=<the site's own value for France>` ("France", "FRANCE"),
//   `sortBy=Most recent` (a stable order: without it the pages overlap), `from=N`, `size=50`
//   (some sites keep 10);
// * offer pages /job/{jobId} carry JobPosting with the full description.
// The filtered search is the list (offers missing from it are closed, when it was read
// whole); a new offer's page is read once for its description, within the page budget per
// run (offers over it wait for the next run: the listing is then partial).

const SOURCE = "phenom";
const PAGE_SIZE = 50;

type PhenomJob = {
  jobId?: string;
  title?: string;
  city?: string;
  state?: string;
  country?: string;
  location?: string;
  postedDate?: string;
  employmentType?: string;
  contractType?: string;
  remote?: string;
  workModel?: string;
};
type Search = { totalHits: number; jobs: PhenomJob[]; countries: string[] };

// The JSON after "phApp.ddo =", read up to its closing brace.
export function phenomData(html: string): Record<string, unknown> | null {
  const start = html.indexOf("phApp.ddo");
  if (start < 0) return null;
  const open = html.indexOf("{", start);
  let depth = 0;
  let inString = false;
  for (let index = open; index < html.length; index++) {
    const char = html[index];
    if (inString) {
      if (char === "\\") index++;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) {
      try {
        return JSON.parse(html.slice(open, index + 1)) as Record<string, unknown>;
      } catch {
        return null;
      }
    }
  }
  return null;
}

async function search(slug: string, params: Record<string, string | number>): Promise<Search> {
  const query = new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)]));
  let html: string;
  try {
    html = (await crawlGet(`${collectorConfig.crawler.scheme}://${slug}/search-results?${query}`)).text;
  } catch (error) {
    if (error instanceof PageGoneError) throw new NotFoundError(error.message);
    throw error;
  }
  const refine = (phenomData(html)?.eagerLoadRefineSearch ?? null) as { totalHits?: number; data?: { jobs?: PhenomJob[]; aggregations?: { field?: string; value?: Record<string, number> }[] } } | null;
  if (!refine?.data) throw new NotFoundError(`${slug}: not a Phenom search page`);
  const countries = Object.keys(refine.data.aggregations?.find((aggregation) => aggregation.field === "country")?.value ?? {});
  return { totalHits: refine.totalHits ?? 0, jobs: refine.data.jobs ?? [], countries };
}

// The site's own value for France in its country filter ("France", "FRANCE"), or null.
const franceValue = (countries: string[]) => countries.find((country) => /^france$/i.test(country.trim())) ?? null;

// "2025-12-23T11:18:53.000+0000": the offset without its colon.
export const phenomDate = (value: string | undefined) => isoDate(value?.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));

const titleCase = (text: string) => (text === text.toUpperCase() ? text.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, before: string, letter: string) => before + letter.toUpperCase()) : text);

export function phenomOffer(slug: string, companyName: string, job: PhenomJob, page: { url: string; description: string | null; validThrough: string | null }): CollectedOffer {
  const location = job.location ?? [job.city, job.state, job.country].filter(Boolean).join(", ");
  const city = job.city && !/^non sp[ée]cifi[ée]|^not specified/i.test(job.city) ? titleCase(job.city) : null;
  const contract = job.contractType ?? job.employmentType ?? null;
  return {
    contractVersion: 1,
    source: SOURCE,
    externalId: `${slug}:${job.jobId}`,
    url: page.url,
    applyUrl: null,
    title: job.title!,
    company: { name: companyName, atsSlug: slug },
    location: { raw: location, city, postcode: /\b(\d{5})\b/.exec(location)?.[1] ?? null, countryCode: "FR" },
    remote: remoteFrom(job.remote, job.workModel, job.title),
    contractType: contractFrom(contract, job.title) ?? (/^permanent$/i.test(contract ?? "") ? "permanent" : null),
    description: { format: "html", content: page.description || job.title! },
    publishedAt: phenomDate(job.postedDate),
    expiresAt: isoDate(page.validThrough),
    collectedAt: new Date().toISOString(),
  };
}

// Every offer in France, by pages, newest first. `complete`: as many as the site counts.
async function franceOffers(slug: string): Promise<{ jobs: PhenomJob[]; complete: boolean }> {
  const first = await search(slug, {});
  const france = franceValue(first.countries);
  if (!france) return { jobs: [], complete: true };
  const jobs = new Map<string, PhenomJob>();
  let total = Infinity;
  let pages = 0;
  for (let from = 0; from < total && pages < collectorConfig.phenom.maxListPages; pages++) {
    const result = await search(slug, { qcountry: france, sortBy: "Most recent", from, size: PAGE_SIZE });
    total = result.totalHits;
    if (!result.jobs.length) break;
    for (const job of result.jobs) if (job.jobId && job.title && (!job.country || /^france$/i.test(job.country))) jobs.set(job.jobId, job);
    from += result.jobs.length;
  }
  return { jobs: [...jobs.values()], complete: jobs.size >= total * 0.98 };
}

export const phenom: AtsAdapter = {
  ats: SOURCE,
  kind: "crawler",
  schedule: "15 5 * * *", // daily, like the career sites
  // No common address: boards are added from `inspect` (Phenom's marks on the page) or by hand.

  async check(slug) {
    const all = await search(slug, {});
    const france = franceValue(all.countries);
    const french = france ? (await search(slug, { qcountry: france, size: 10 })).totalHits : 0;
    return { companyName: companyFromHost(slug.split("/")[0]), jobCount: all.totalHits, franceJobCount: french };
  },

  async *collect(slug, companyName, known): AsyncGenerator<CollectedRecord | StillListed | PartialListing> {
    const { jobs, complete } = await franceOffers(slug);
    if (!complete) yield { partialListing: true };
    let pagesRead = 0;
    let failures = 0;
    let waiting = false;
    for (const job of jobs) {
      const externalId = `${slug}:${job.jobId}`;
      if (known?.has(externalId) && known.get(externalId) === (job.postedDate ?? null) && !refreshDue(externalId)) {
        yield { stillListed: externalId };
        continue;
      }
      if (pagesRead >= collectorConfig.crawler.maxOfferPagesPerRun) {
        if (known?.has(externalId)) yield { stillListed: externalId };
        else waiting = true;
        continue;
      }
      pagesRead++;
      const url = `${collectorConfig.crawler.scheme}://${slug}/job/${encodeURIComponent(job.jobId!)}`;
      let posting: Record<string, unknown> | undefined;
      try {
        posting = extractJobPostings((await crawlGet(url)).text)[0] as Record<string, unknown> | undefined;
        failures = 0;
      } catch (error) {
        if (!(error instanceof CrawlError)) throw error;
        if (error instanceof PageGoneError) continue;
        if (++failures >= 5) throw error;
        if (known?.has(externalId)) yield { stillListed: externalId };
        continue;
      }
      const description = typeof posting?.description === "string" ? decodeEntities(posting.description) : null;
      const validThrough = typeof posting?.validThrough === "string" ? posting.validThrough : null;
      yield { raw: { url, releasedDate: job.postedDate ?? null, job }, offer: phenomOffer(slug, companyName, job, { url, description, validThrough }) };
    }
    // New offers left for the next run: nothing may be closed this time.
    if (waiting && complete) yield { partialListing: true };
  },
};
