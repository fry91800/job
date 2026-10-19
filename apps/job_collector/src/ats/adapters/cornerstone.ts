import type { CollectedOffer } from "@job/shared";
import { collectorConfig } from "../../config";
import type { CollectedRecord } from "../../connectors/types";
import { CrawlError, crawlGet, crawlPostJson, PageGoneError } from "../../crawler/fetcher";
import { decodeEntities, extractJobPostings } from "../../crawler/job-posting";
import { refreshDue, type AtsAdapter, type PartialListing, type StillListed } from "../adapter";
import { NotFoundError } from "../http";
import { contractFrom, remoteFrom } from "../mapping";

// Cornerstone OnDemand career sites (COLLECTOR.md §17.19): board = the tenant's host and the
// career site's number, "groupeavril.csod.com/2". Checked 2026-10-19 on Avril:
// * robots.txt allows everything (crawl-delay 10, obeyed);
// * the career site's page (/ux/ats/careersite/{n}/home?c={tenant}) gives its pages a public
//   token and the API's address ("cloud": "https://uk.api.csod.com/");
// * the site's own search: POST {cloud}rec-job-search/external/jobs with that token →
//   totalCount and requisitions (requisitionId, displayJobTitle, postingEffectiveDate
//   "16/10/2026", locations [{city, country}], externalDescription — plain text, shortened);
// * offer pages (/ux/ats/careersite/{n}/home/requisition/{id}) carry JobPosting with the full
//   description: read once per new offer, within the page budget per run.

const SOURCE = "cornerstone";
const PAGE_SIZE = 50;

type Requisition = { requisitionId?: number | string; displayJobTitle?: string; postingEffectiveDate?: string; locations?: { city?: string; country?: string }[]; externalDescription?: string };

export function cornerstoneSite(slug: string): { origin: string; tenant: string; site: string } {
  const [host, site = "1"] = slug.split("/");
  return { origin: `${collectorConfig.crawler.scheme}://${host}`, tenant: host.split(".")[0], site };
}

const sitePage = (slug: string, path = "") => {
  const { origin, tenant, site } = cornerstoneSite(slug);
  return `${origin}/ux/ats/careersite/${site}/home${path}?c=${tenant}&lang=fr-FR`;
};

// The public token and API address the career site's page gives its own scripts.
async function session(slug: string): Promise<{ token: string; api: string }> {
  let html: string;
  try {
    html = (await crawlGet(sitePage(slug))).text;
  } catch (error) {
    if (error instanceof PageGoneError) throw new NotFoundError(error.message);
    throw error;
  }
  const token = /"token"\s*:\s*"([A-Za-z0-9._-]{20,})"/.exec(html)?.[1];
  const api = /"cloud"\s*:\s*"(https?:\/\/[a-z0-9.:-]+\/)"/.exec(html)?.[1];
  if (!token || !api) throw new NotFoundError(`${slug}: not a Cornerstone career site`);
  return { token, api };
}

async function allRequisitions(slug: string): Promise<{ requisitions: Requisition[]; total: number }> {
  const { token, api } = await session(slug);
  const site = Number(cornerstoneSite(slug).site);
  const all = new Map<string, Requisition>();
  let total = Infinity;
  for (let page = 1; all.size < total && page <= collectorConfig.cornerstone.maxListPages; page++) {
    const answer = await crawlPostJson<{ data?: { totalCount?: number; requisitions?: Requisition[] } }>(
      `${api}rec-job-search/external/jobs`,
      { careerSiteId: site, careerSitePageId: site, pageNumber: page, pageSize: PAGE_SIZE, cultureName: "fr-FR", searchText: "", states: [], countryCodes: [], cities: [], placeID: "", radius: null, postingsWithinDays: null, customFieldCheckboxKeys: [], customFieldDropdowns: [], customFieldRadios: [] },
      { Authorization: `Bearer ${token}` },
    );
    total = answer.data?.totalCount ?? 0;
    const requisitions = answer.data?.requisitions ?? [];
    if (!requisitions.length) break;
    for (const requisition of requisitions) if (requisition.requisitionId && requisition.displayJobTitle) all.set(String(requisition.requisitionId), requisition);
  }
  return { requisitions: [...all.values()], total };
}

const inFrance = (requisition: Requisition) => (requisition.locations ?? []).some((location) => location.country === "FR");

// "16/10/2026" (day first: the French culture is asked for) → ISO.
const frenchDate = (value: string | undefined) => {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value ?? "");
  return match ? `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}T00:00:00.000Z` : null;
};

export function cornerstoneOffer(slug: string, companyName: string, requisition: Requisition, page: { url: string; description: string | null; employmentType: string | null }): CollectedOffer {
  const french = requisition.locations?.find((location) => location.country === "FR");
  const town = french?.city ?? null;
  const city = town && town === town.toUpperCase() ? town.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, before: string, letter: string) => before + letter.toUpperCase()) : town;
  return {
    contractVersion: 1,
    source: SOURCE,
    externalId: `${slug}:${requisition.requisitionId}`,
    url: page.url,
    applyUrl: null,
    title: requisition.displayJobTitle!,
    company: { name: companyName, atsSlug: slug },
    location: { raw: town, city, countryCode: "FR" },
    remote: remoteFrom(requisition.displayJobTitle),
    contractType: contractFrom(requisition.displayJobTitle, page.employmentType) ?? contractFrom(requisition.externalDescription?.slice(0, 300)),
    description: page.description ? { format: "html", content: page.description } : { format: "text", content: requisition.externalDescription?.trim() || requisition.displayJobTitle! },
    publishedAt: frenchDate(requisition.postingEffectiveDate),
    collectedAt: new Date().toISOString(),
  };
}

export const cornerstone: AtsAdapter = {
  ats: SOURCE,
  kind: "crawler",
  schedule: "30 7 * * *", // daily, like the career sites
  // Every tenant is a csod.com host: Common Crawl's index lists their career sites.
  discovery: {
    prefixes: ["*.csod.com"],
    slugFromUrl: (url) => {
      const site = /^\/ux\/ats\/careersite\/(\d+)(\/|$)/.exec(url.pathname)?.[1];
      return site && /^[a-z0-9-]+\.csod\.com$/.test(url.hostname) ? `${url.hostname}/${site}` : null;
    },
  },

  async check(slug) {
    const { requisitions, total } = await allRequisitions(slug);
    return { companyName: null, jobCount: total, franceJobCount: requisitions.filter(inFrance).length };
  },

  async *collect(slug, companyName, known): AsyncGenerator<CollectedRecord | StillListed | PartialListing> {
    const { requisitions, total } = await allRequisitions(slug);
    if (requisitions.length < total * 0.98) yield { partialListing: true };
    let pagesRead = 0;
    let failures = 0;
    let waiting = false;
    for (const requisition of requisitions.filter(inFrance)) {
      const externalId = `${slug}:${requisition.requisitionId}`;
      const version = requisition.postingEffectiveDate ?? null;
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
      const url = sitePage(slug, `/requisition/${requisition.requisitionId}`);
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
      const employmentType = Array.isArray(posting?.employmentType) ? posting.employmentType.join(" ") : typeof posting?.employmentType === "string" ? posting.employmentType : null;
      yield { raw: { url, releasedDate: version, requisition }, offer: cornerstoneOffer(slug, companyName, requisition, { url, description, employmentType }) };
    }
    if (waiting) yield { partialListing: true };
  },
};
