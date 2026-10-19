import type { CollectedOffer } from "@job/shared";
import { collectorConfig } from "../../config";
import type { CollectedRecord } from "../../connectors/types";
import { CrawlError, crawlGet, PageGoneError } from "../../crawler/fetcher";
import { decodeEntities, extractJobPostings } from "../../crawler/job-posting";
import { refreshDue, type AtsAdapter, type PartialListing, type StillListed } from "../adapter";
import { NotFoundError } from "../http";
import { contractFrom, isoDate, remoteFrom } from "../mapping";
import { companyFromHost } from "./successfactors";

// iCIMS career sites built with Jibe ("iCIMS Attract": jobs.axa.com,
// careers.publicisgroupe.com), COLLECTOR.md §17.14. Board = the site's host. Checked
// 2026-10-18 on AXA and Publicis:
// * robots.txt allows everything;
// * the site's own JSON list: GET /api/jobs?country=France&page=N&limit=100 → totalCount and
//   jobs[].data (req_id/slug, title, city, postal_code, country_code, posted_date,
//   update_date, tags with the contract, apply_url) — the description there is flattened
//   to one paragraph;
// * offer pages /jobs/{slug} (redirected to the site's path) carry JobPosting with the
//   description in HTML.
// The filtered list is the list (offers missing from it are closed, when read whole); a new
// or updated offer's page is read once for its description, within the page budget per run.

const SOURCE = "jibe";
const PAGE_SIZE = 100;

type JibeJob = {
  slug?: string;
  req_id?: string;
  title?: string;
  description?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country_code?: string;
  full_location?: string;
  posted_date?: string;
  update_date?: string;
  tags1?: string[];
  tags2?: string[];
  tags3?: string[];
  apply_url?: string;
};
type ListPage = { totalCount?: number; jobs?: { data?: JibeJob }[] };

// "2026-10-16T10:00:00+0000": the offset without its colon.
const jibeDate = (value: string | undefined) => isoDate(value?.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));

async function listPage(slug: string, page: number, limit = PAGE_SIZE): Promise<ListPage> {
  const url = `${collectorConfig.crawler.scheme}://${slug}/api/jobs?${new URLSearchParams({ country: "France", page: String(page), limit: String(limit) })}`;
  let text: string;
  try {
    text = (await crawlGet(url, { accept: "application/json" })).text;
  } catch (error) {
    if (error instanceof PageGoneError) throw new NotFoundError(error.message);
    throw error;
  }
  try {
    return JSON.parse(text) as ListPage;
  } catch {
    throw new NotFoundError(`${slug}: no Jibe job list`);
  }
}

async function franceJobs(slug: string): Promise<{ jobs: JibeJob[]; complete: boolean }> {
  const jobs = new Map<string, JibeJob>();
  let total = Infinity;
  for (let page = 1; jobs.size < total && page <= collectorConfig.jibe.maxListPages; page++) {
    const result = await listPage(slug, page);
    total = result.totalCount ?? 0;
    const items = (result.jobs ?? []).map((item) => item.data).filter((job): job is JibeJob => !!job);
    if (!items.length) break;
    for (const job of items) if ((job.slug ?? job.req_id) && job.title && job.country_code === "FR") jobs.set((job.slug ?? job.req_id)!, job);
  }
  return { jobs: [...jobs.values()], complete: jobs.size >= total * 0.98 };
}

// "NANTERRE" → "Nanterre"; "35-ILLE-ET-VILAINE" is a département, not a town.
function place(job: JibeJob): { city: string | null; postcode: string | null; countyCode: string | null } {
  const county = /^(\d{2,3}|2[AB])\s*-\s*/i.exec(job.city ?? "");
  const city = county || !job.city ? null : job.city === job.city.toUpperCase() ? job.city.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, before: string, letter: string) => before + letter.toUpperCase()) : job.city;
  const postcode = /^\d{5}$/.test(job.postal_code ?? "") ? job.postal_code! : null;
  return { city, postcode, countyCode: county?.[1].toUpperCase() ?? (postcode ? postcode.slice(0, postcode.startsWith("97") ? 3 : 2) : null) };
}

export function jibeOffer(slug: string, companyName: string, job: JibeJob, page: { url: string; description: string | null; employmentType: string | null }): CollectedOffer {
  const where = place(job);
  const tags = [...(job.tags1 ?? []), ...(job.tags2 ?? []), ...(job.tags3 ?? [])];
  return {
    contractVersion: 1,
    source: SOURCE,
    externalId: `${slug}:${job.slug ?? job.req_id}`,
    url: page.url,
    applyUrl: job.apply_url && /^https?:\/\//.test(job.apply_url) ? job.apply_url : null,
    title: job.title!,
    company: { name: companyName, atsSlug: slug },
    location: { raw: job.full_location ?? job.city ?? null, city: where.city, postcode: where.postcode, countyCode: where.countyCode, countryCode: "FR" },
    remote: remoteFrom(job.title, ...tags),
    contractType: contractFrom(job.title, ...tags, page.employmentType),
    description: { format: "html", content: page.description || job.description || job.title! },
    publishedAt: jibeDate(job.posted_date),
    collectedAt: new Date().toISOString(),
  };
}

export const jibe: AtsAdapter = {
  ats: SOURCE,
  kind: "crawler",
  schedule: "45 5 * * *", // daily, like the career sites
  // No common address: boards are added from `inspect` (jibecdn.com on the page) or by hand.

  async check(slug) {
    const france = (await listPage(slug, 1, 1)).totalCount ?? 0;
    return { companyName: companyFromHost(slug), jobCount: france, franceJobCount: france };
  },

  async *collect(slug, companyName, known): AsyncGenerator<CollectedRecord | StillListed | PartialListing> {
    const { jobs, complete } = await franceJobs(slug);
    if (!complete) yield { partialListing: true };
    let pagesRead = 0;
    let failures = 0;
    let waiting = false;
    for (const job of jobs) {
      const id = job.slug ?? job.req_id!;
      const externalId = `${slug}:${id}`;
      const version = job.update_date ?? job.posted_date ?? null;
      if (known?.has(externalId) && known.get(externalId) === version && !refreshDue(externalId)) {
        yield { stillListed: externalId };
        continue;
      }
      if (pagesRead >= collectorConfig.crawler.maxOfferPagesPerRun) {
        if (known?.has(externalId)) yield { stillListed: externalId };
        else waiting = true;
        continue;
      }
      pagesRead++;
      let page: { url: string; text: string };
      try {
        page = await crawlGet(`${collectorConfig.crawler.scheme}://${slug}/jobs/${encodeURIComponent(id)}?lang=fr-fr`);
        failures = 0;
      } catch (error) {
        if (!(error instanceof CrawlError)) throw error;
        if (error instanceof PageGoneError) continue;
        if (++failures >= 5) throw error;
        if (known?.has(externalId)) yield { stillListed: externalId };
        continue;
      }
      const posting = extractJobPostings(page.text)[0] as Record<string, unknown> | undefined;
      const description = typeof posting?.description === "string" ? decodeEntities(posting.description) : null;
      const employmentType = Array.isArray(posting?.employmentType) ? posting.employmentType.join(" ") : typeof posting?.employmentType === "string" ? posting.employmentType : null;
      yield { raw: { url: page.url, releasedDate: version, job: { ...job, description: undefined } }, offer: jibeOffer(slug, companyName, job, { url: page.url, description, employmentType }) };
    }
    if (waiting && complete) yield { partialListing: true };
  },
};
