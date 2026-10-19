import { collectorConfig } from "../../config";
import type { CollectedRecord } from "../../connectors/types";
import { CrawlError, crawlGet, crawlPostJson, PageGoneError } from "../../crawler/fetcher";
import { extractJobPostings, frenchPlace, jobPostingOffer, type JobPosting } from "../../crawler/job-posting";
import { refreshDue, type AtsAdapter, type StillListed } from "../adapter";
import { NotFoundError } from "../http";
import { frenchCity, nameFromSlug } from "../mapping";

// Workday career sites (COLLECTOR.md §17.10): {tenant}.wd{N}.myworkdayjobs.com/{Site}, large
// employers. Checked 2026-10-17 (Sanofi, NVIDIA): robots.txt allows the site and only
// forbids /refreshFacet/; job pages carry JobPosting (Google for Jobs) in plain HTML; the
// sitemap lists only 100 jobs (Sanofi: 989 open). The job list comes from the JSON feed the
// career page itself calls (POST /wday/cxs/{tenant}/{Site}/jobs, 20 per request), filtered
// on France with the site's own "Country" filter: only French jobs are listed and fetched
// (Sanofi: 150 of 989), the list is complete (offers missing from it are closed), and each
// new job is read from its public page.

const SOURCE = "workday";
const HOST = /^([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com$/;
const LOCALE = /^[a-z]{2}(-[A-Za-z]{2})?$/;
const NOT_SITES = new Set(["wday", "refreshfacet", "talentcommunity", "login", "assets", "job", "jobs"]);

const PAGE_SIZE = 20; // the most Workday answers per request
const TOTAL_CAP = 2000; // the largest total Workday reports

type Facet = { facetParameter?: string; descriptor?: string; id?: string; count?: number; values?: Facet[] };
type JobItem = { title?: string; externalPath?: string; locationsText?: string; startDate?: string; bulletFields?: string[] };
type ListPage = { total?: number; jobPostings?: JobItem[]; facets?: Facet[] };

// "sanofi.wd3.myworkdayjobs.com/SanofiCareers": tenant "sanofi", site "SanofiCareers".
export function workdaySite(slug: string): { origin: string; tenant: string; site: string } {
  const [host, site] = slug.split("/");
  const tenant = HOST.exec(host)?.[1] ?? host.split(".")[0];
  return { origin: `${collectorConfig.crawler.scheme}://${host}`, tenant, site };
}

export function workdaySlugFromUrl(url: URL): string | null {
  const host = url.hostname.toLowerCase();
  if (!HOST.test(host)) return null;
  const segments = url.pathname.split("/").filter(Boolean);
  const site = LOCALE.test(segments[0] ?? "") ? segments[1] : segments[0];
  return site && /^[A-Za-z0-9_-]{2,80}$/.test(site) && !NOT_SITES.has(site.toLowerCase()) ? `${host}/${site}` : null;
}

// The site's France value of its "Country" filter, wherever it sits in the facets.
export function franceFilter(facets: Facet[] | undefined): { parameter: string; id: string; count: number } | null {
  for (const facet of facets ?? []) {
    if (facet.facetParameter && /country/i.test(facet.facetParameter)) {
      const france = facet.values?.find((value) => /^france$/i.test((value.descriptor ?? "").trim()));
      if (france?.id) return { parameter: facet.facetParameter, id: france.id, count: france.count ?? 0 };
    }
    const nested = franceFilter(facet.values);
    if (nested) return nested;
  }
  return null;
}

async function listPage(slug: string, offset: number, appliedFacets: Record<string, string[]>): Promise<ListPage> {
  const { origin, tenant, site } = workdaySite(slug);
  try {
    return await crawlPostJson<ListPage>(`${origin}/wday/cxs/${tenant}/${site}/jobs`, { appliedFacets, limit: PAGE_SIZE, offset, searchText: "" });
  } catch (error) {
    if (error instanceof PageGoneError) throw new NotFoundError(error.message);
    throw error;
  }
}

// A second filter splitting a list over Workday's 2 000 cap: values each under the cap that
// together cover the list (Babilou: 3 351 French jobs, 35 job profiles), fewest values first.
export function splitFilter(facets: Facet[] | undefined, total: number, exclude: string): { parameter: string; ids: string[] } | null {
  let best: { parameter: string; ids: string[] } | null = null;
  const visit = (list: Facet[] | undefined) => {
    for (const facet of list ?? []) {
      const values = (facet.values ?? []).filter((value) => value.id && typeof value.count === "number");
      if (facet.facetParameter && facet.facetParameter !== exclude && values.length) {
        const counts = values.map((value) => value.count!);
        if (Math.max(...counts) < TOTAL_CAP && counts.reduce((sum, count) => sum + count, 0) >= total && (!best || values.length < best.ids.length)) {
          best = { parameter: facet.facetParameter, ids: values.map((value) => value.id!) };
        }
      }
      visit(facet.values);
    }
  };
  visit(facets);
  return best;
}

// One search's jobs, page after page. Workday gives the total on the first page only (later
// pages say 0) and caps it at 2 000; past the end, offsets answer full pages of jobs already
// seen. The list ends at `bound` (a filter's count, exact), else at the total when under the
// cap, at a short page, or at a page without new jobs.
async function listSearch(slug: string, applied: Record<string, string[]>, seen: Set<string>, bound?: number, first?: ListPage): Promise<JobItem[]> {
  let page = first ?? (await listPage(slug, 0, applied));
  const total = page.total ?? 0;
  const limit = bound || (total > 0 && total < TOTAL_CAP ? total : Infinity);
  const jobs: JobItem[] = [];
  const here = new Set<string>(); // this search's jobs: repeats mean its end
  for (let index = 0; index < collectorConfig.workday.maxListPages; index++) {
    const fresh = (page.jobPostings ?? []).filter((item) => !here.has(item.externalPath ?? "") && here.add(item.externalPath ?? ""));
    // Jobs already listed by another part (a job under two values) are kept once.
    jobs.push(...fresh.filter((item) => !seen.has(item.externalPath ?? "") && seen.add(item.externalPath ?? "")));
    if (fresh.length === 0 || (page.jobPostings ?? []).length < PAGE_SIZE || here.size >= limit) break;
    page = await listPage(slug, (index + 1) * PAGE_SIZE, applied);
  }
  return jobs;
}

// Every job of the site, France only when the site has a country filter; a French list over
// the cap is read in parts, by a second filter.
async function listJobs(slug: string): Promise<{ jobs: JobItem[]; filtered: boolean }> {
  const first = await listPage(slug, 0, {});
  const france = franceFilter(first.facets);
  const seen = new Set<string>();
  if (!france) return { jobs: await listSearch(slug, {}, seen, undefined, first), filtered: false };
  const applied = { [france.parameter]: [france.id] };
  const firstFrench = await listPage(slug, 0, applied);
  const split = france.count >= TOTAL_CAP ? splitFilter(firstFrench.facets, france.count, france.parameter) : null;
  if (!split) return { jobs: await listSearch(slug, applied, seen, france.count, firstFrench), filtered: true };
  const jobs: JobItem[] = [];
  for (const id of split.ids) jobs.push(...(await listSearch(slug, { ...applied, [split.parameter]: [id] }, seen)));
  return { jobs, filtered: true };
}

// The job's stable id: its requisition number ("R2861488"), else the end of its address.
const jobId = (item: JobItem) => {
  const requisition = item.bulletFields?.find((field) => /^[A-Za-z]*[-_]?\d{3,}[\w-]*$/.test(field.trim()));
  return (requisition ?? item.externalPath?.split("_").pop() ?? item.externalPath ?? "").trim().slice(0, 120);
};

// A job listed under the France filter whose page names another place first (several
// locations): placed from the list's location text.
function listedPlace(item: JobItem) {
  const raw = item.locationsText ?? "France";
  return { city: frenchCity(raw), postcode: null, region: null, country: "France", latitude: null, longitude: null, raw };
}

// "sanofi.wd3.myworkdayjobs.com/SanofiCareers" → "Sanofi".
export const companyFromSlug = (slug: string) => nameFromSlug(workdaySite(slug).tenant);

// Jobs read and skipped (not in France, no markup), by external id → start date.
const skipped = new Map<string, string | null>();

export const workday: AtsAdapter = {
  ats: SOURCE,
  kind: "ats", // the employer's own system
  schedule: "0 6 * * *", // daily, read like the career sites
  discovery: { prefixes: ["*.myworkdayjobs.com"], slugFromUrl: workdaySlugFromUrl },

  async check(slug) {
    const first = await listPage(slug, 0, {});
    const total = first.total ?? first.jobPostings?.length ?? 0;
    const france = franceFilter(first.facets);
    if (france) return { companyName: companyFromSlug(slug), jobCount: total, franceJobCount: france.count };
    // No country filter: a few job pages decide.
    const { origin, site } = workdaySite(slug);
    let read = 0;
    let french = 0;
    for (const item of (first.jobPostings ?? []).slice(0, collectorConfig.crawler.checkSamplePages)) {
      try {
        const postings = extractJobPostings((await crawlGet(`${origin}/${site}${item.externalPath}`)).text);
        read++;
        if (postings.some((posting) => frenchPlace(posting))) french++;
      } catch (error) {
        if (!(error instanceof CrawlError)) throw error;
      }
    }
    return { companyName: companyFromSlug(slug), jobCount: total, franceJobCount: read ? Math.round((total * french) / read) : 0 };
  },

  async *collect(slug, companyName, known): AsyncGenerator<CollectedRecord | StillListed> {
    const { origin, site } = workdaySite(slug);
    const { jobs, filtered } = await listJobs(slug);
    let fetched = 0;
    let failures = 0;
    for (const item of jobs) {
      if (!item.externalPath) continue;
      const key = jobId(item);
      const externalId = `${slug}:${key}`.slice(0, 200);
      const date = item.startDate ?? null;
      const unchanged = (stored: string | null | undefined) => stored === date && !refreshDue(externalId);
      if (known?.has(externalId) && unchanged(known.get(externalId))) {
        yield { stillListed: externalId };
        continue;
      }
      if (skipped.has(externalId) && unchanged(skipped.get(externalId))) continue;
      if (fetched >= collectorConfig.crawler.maxOfferPagesPerRun) {
        if (known?.has(externalId)) yield { stillListed: externalId };
        continue;
      }
      fetched++;
      let page: { url: string; text: string };
      try {
        page = await crawlGet(`${origin}/${site}${item.externalPath}`);
        failures = 0;
      } catch (error) {
        if (!(error instanceof CrawlError)) throw error;
        if (error instanceof PageGoneError) continue;
        if (++failures >= 5) throw error; // the site is failing: stop, nothing gets closed
        if (known?.has(externalId)) yield { stillListed: externalId };
        continue;
      }
      const postings: JobPosting[] = extractJobPostings(page.text);
      const posting = postings[0];
      const place = posting ? (frenchPlace(posting) ?? (filtered ? listedPlace(item) : null)) : null;
      if (!posting || !place) {
        skipped.set(externalId, date);
        continue;
      }
      skipped.delete(externalId);
      const offer = jobPostingOffer(posting, { url: page.url, key, source: SOURCE, siteSlug: slug, place });
      // The board's company: the pages name legal entities with codes ("(0122) Sanofi
      // Winthrop Industrie"), which would split one employer into many.
      offer.company = { name: companyName, atsSlug: slug };
      yield { raw: { url: page.url, releasedDate: date, item, jobPosting: posting }, offer };
    }
  },
};

// Tests.
export function resetWorkdayMemory(): void {
  skipped.clear();
}
