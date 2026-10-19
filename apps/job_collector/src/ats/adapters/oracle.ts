import type { CollectedOffer } from "@job/shared";
import { collectorConfig } from "../../config";
import type { CollectedRecord } from "../../connectors/types";
import { CrawlError, crawlGet, PageGoneError } from "../../crawler/fetcher";
import { refreshDue, type AtsAdapter, type PartialListing, type StillListed } from "../adapter";
import { NotFoundError } from "../http";
import { contractFrom, isoDate, remoteFrom } from "../mapping";

// Oracle Recruiting Cloud career sites ("Candidate Experience", COLLECTOR.md §17.18): board =
// host and site number, "eoct.fa.em2.oraclecloud.com/careers". Checked 2026-10-19 on
// Savencia and Scor: no robots.txt; the site's own public REST API —
// * recruitingCEJobRequisitions?finder=findReqs;siteNumber=…,limit=25,offset=N,
//   sortBy=POSTING_DATES_DESC → TotalJobsCount and requisitionList; with
//   facetsList=LOCATIONS, the location filter's values and counts (France: an Id), and with
//   selectedLocationsFacet=<that Id>, only offers placed in France (main or other place) (Id, Title, PostedDate,
//   PrimaryLocation "VIROFLAY, 78-Yvelines, France", PrimaryLocationCountry,
//   secondaryLocations);
// * recruitingCEJobRequisitionDetails?finder=ById;Id="…",siteNumber=… → the texts in HTML
//   (ExternalDescriptionStr, responsibilities, qualifications, CorporateDescriptionStr),
//   JobSchedule, ContractType.
// Offers in France (main or other place) are kept; a new offer's details are read once,
// within the page budget per run.

const SOURCE = "oracle";
const PAGE_SIZE = 25;
const API = "/hcmRestApi/resources/latest";

type Requisition = {
  Id?: string;
  Title?: string;
  PostedDate?: string;
  PrimaryLocation?: string;
  PrimaryLocationCountry?: string;
  secondaryLocations?: { CountryCode?: string; Name?: string }[];
};
type Details = {
  ExternalDescriptionStr?: string;
  ExternalResponsibilitiesStr?: string;
  ExternalQualificationsStr?: string;
  CorporateDescriptionStr?: string;
  JobSchedule?: string;
  ContractType?: string;
  WorkplaceType?: string;
};

export function oracleSite(slug: string): { origin: string; site: string } {
  const [host, site] = slug.split("/");
  return { origin: `${collectorConfig.crawler.scheme}://${host}`, site };
}

async function api<T>(slug: string, path: string): Promise<T> {
  let text: string;
  try {
    text = (await crawlGet(`${oracleSite(slug).origin}${API}/${path}`, { accept: "application/json" })).text;
  } catch (error) {
    if (error instanceof PageGoneError) throw new NotFoundError(error.message);
    throw error;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new NotFoundError(`${slug}: not an Oracle Recruiting site`);
  }
}

// The site's France value in its location filter, with its count (one request).
async function franceFacet(slug: string): Promise<{ total: number; france: { id: string; count: number } | null }> {
  const { site } = oracleSite(slug);
  const finder = `findReqs;siteNumber=${site},facetsList=LOCATIONS,limit=1`;
  const answer = await api<{ items?: { TotalJobsCount?: number; locationsFacet?: { Id?: number | string; Name?: string; TotalCount?: number }[] }[] }>(slug, `recruitingCEJobRequisitions?onlyData=true&expand=locationsFacet&finder=${encodeURIComponent(finder)}`);
  const item = answer.items?.[0];
  if (!item) throw new NotFoundError(`${slug}: no job list`);
  const france = item.locationsFacet?.find((facet) => /^france$/i.test(facet.Name?.trim() ?? ""));
  return { total: item.TotalJobsCount ?? 0, france: france?.Id ? { id: String(france.Id), count: france.TotalCount ?? 0 } : null };
}

async function listPage(slug: string, offset: number, franceId: string | null) {
  const { site } = oracleSite(slug);
  const finder = `findReqs;siteNumber=${site},${franceId ? `selectedLocationsFacet=${franceId},` : ""}limit=${PAGE_SIZE},offset=${offset},sortBy=POSTING_DATES_DESC`;
  const answer = await api<{ items?: { TotalJobsCount?: number; requisitionList?: Requisition[] }[] }>(slug, `recruitingCEJobRequisitions?onlyData=true&expand=requisitionList.secondaryLocations&finder=${encodeURIComponent(finder)}`);
  const item = answer.items?.[0];
  if (!item) throw new NotFoundError(`${slug}: no job list`);
  return { total: item.TotalJobsCount ?? 0, requisitions: item.requisitionList ?? [] };
}

const inFrance = (requisition: Requisition) => requisition.PrimaryLocationCountry === "FR" || (requisition.secondaryLocations ?? []).some((location) => location.CountryCode === "FR");

// Every offer of the site, or only those in France when its location filter has France.
async function allRequisitions(slug: string, franceId: string | null): Promise<{ requisitions: Requisition[]; total: number }> {
  const all = new Map<string, Requisition>();
  let total = Infinity;
  // The next page starts after the offers received (a site may send fewer than asked).
  for (let offset = 0, pages = 0; offset < total && pages < collectorConfig.oracle.maxListPages; pages++) {
    const page = await listPage(slug, offset, franceId);
    total = page.total;
    if (!page.requisitions.length) break;
    for (const requisition of page.requisitions) if (requisition.Id && requisition.Title) all.set(requisition.Id, requisition);
    offset += page.requisitions.length;
  }
  return { requisitions: [...all.values()], total };
}

// "VIROFLAY, 78-Yvelines, France": the town and its département.
function place(requisition: Requisition): { city: string | null; countyCode: string | null } {
  const main = requisition.PrimaryLocationCountry === "FR" ? requisition.PrimaryLocation : requisition.secondaryLocations?.find((location) => location.CountryCode === "FR")?.Name;
  const parts = (main ?? "").split(",").map((part) => part.trim());
  const county = parts.map((part) => /^(\d{2,3}|2[AB])\s*-/i.exec(part)?.[1]).find(Boolean) ?? null;
  const town = parts[0] && !/^france$/i.test(parts[0]) && !/^\d{2,3}\s*-/.test(parts[0]) ? parts[0] : null;
  const city = town && town === town.toUpperCase() ? town.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, before: string, letter: string) => before + letter.toUpperCase()) : town;
  return { city, countyCode: county?.toUpperCase() ?? null };
}

export function oracleOffer(slug: string, companyName: string, requisition: Requisition, details: Details | null): CollectedOffer {
  const { origin, site } = oracleSite(slug);
  const where = place(requisition);
  const description = [details?.ExternalDescriptionStr, details?.ExternalResponsibilitiesStr, details?.ExternalQualificationsStr, details?.CorporateDescriptionStr].filter((part) => part && part.trim()).join("");
  return {
    contractVersion: 1,
    source: SOURCE,
    externalId: `${slug}:${requisition.Id}`,
    url: `${origin}/hcmUI/CandidateExperience/fr/sites/${site}/job/${requisition.Id}`,
    applyUrl: null,
    title: requisition.Title!,
    company: { name: companyName, atsSlug: slug },
    location: { raw: requisition.PrimaryLocation ?? null, city: where.city, countyCode: where.countyCode, countryCode: "FR" },
    remote: remoteFrom(details?.WorkplaceType, requisition.Title),
    contractType: contractFrom(requisition.Title, details?.ContractType),
    description: { format: "html", content: description || requisition.Title! },
    publishedAt: isoDate(requisition.PostedDate),
    collectedAt: new Date().toISOString(),
  };
}

// The company's name from the career site's title ("Site Carrière Savencia", "Careers at
// SCOR", "SCOR"), boilerplate words removed; null when it can't be read.
export function companyFromTitle(title: string): string | null {
  const text = title
    .replace(/\\u([0-9a-f]{4})/gi, (_, code: string) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&([a-z])(grave|acute|circ|uml);/gi, "$1")
    .replace(/&amp;/g, "&")
    .replace(/\\?'/g, "'")
    .replace(/\b(site|sites|carri[eè]res?|careers?|career site|jobs?|emplois?|offres?( d'emploi)?|recrutement|join|rejoignez|rejoindre|nous|us|at|chez|de|du|the|portal|portail|d'exp[eé]rience candidat|exp[eé]rience candidat|candidate experience|opportunit[eé]s( au sein)?( du| de| des)?|recommended|external|externe|interne|internal)\b/gi, " ")
    .replace(/_(fr|en)$/i, "")
    .replace(/[|:–—-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length >= 2 && text.length <= 60 ? text : null;
}

async function companyName(slug: string): Promise<string | null> {
  const { origin, site } = oracleSite(slug);
  try {
    const html = (await crawlGet(`${origin}/hcmUI/CandidateExperience/fr/sites/${site}`)).text;
    const title = /<title>([^<]*)<\/title>/i.exec(html)?.[1];
    return title ? companyFromTitle(title) : null;
  } catch (error) {
    if (error instanceof CrawlError) return null;
    throw error;
  }
}

export const oracle: AtsAdapter = {
  ats: SOURCE,
  kind: "crawler",
  schedule: "0 7 * * *", // daily, like the career sites
  // Every site is an oraclecloud.com host: Common Crawl's index lists them.
  discovery: {
    prefixes: ["*.oraclecloud.com"],
    slugFromUrl: (url) => {
      const site = /^\/hcmUI\/CandidateExperience\/[a-zA-Z_-]+\/sites\/([A-Za-z0-9_]+)(\/|$)/.exec(url.pathname)?.[1];
      return site ? `${url.hostname}/${site}` : null;
    },
  },

  async check(slug) {
    // The location filter's count when the site has one, else the whole list.
    const { total, france } = await franceFacet(slug);
    const french = france ? france.count : (await allRequisitions(slug, null)).requisitions.filter(inFrance).length;
    return { companyName: french ? await companyName(slug) : null, jobCount: total, franceJobCount: french };
  },

  async *collect(slug, companyName, known): AsyncGenerator<CollectedRecord | StillListed | PartialListing> {
    const { france } = await franceFacet(slug);
    const { requisitions, total } = await allRequisitions(slug, france?.id ?? null);
    if (requisitions.length < total * 0.98) yield { partialListing: true };
    const { site } = oracleSite(slug);
    let pagesRead = 0;
    let failures = 0;
    let waiting = false;
    for (const requisition of requisitions.filter(inFrance)) {
      const externalId = `${slug}:${requisition.Id}`;
      const version = requisition.PostedDate ?? null;
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
      let details: Details | null = null;
      try {
        const finder = `ById;Id="${requisition.Id}",siteNumber=${site}`;
        details = (await api<{ items?: Details[] }>(slug, `recruitingCEJobRequisitionDetails?expand=all&onlyData=true&finder=${encodeURIComponent(finder)}`)).items?.[0] ?? null;
        failures = 0;
      } catch (error) {
        if (error instanceof NotFoundError) continue;
        if (!(error instanceof CrawlError)) throw error;
        if (++failures >= 5) throw error;
        if (known?.has(externalId)) yield { stillListed: externalId };
        continue;
      }
      yield { raw: { releasedDate: version, requisition, details }, offer: oracleOffer(slug, companyName, requisition, details) };
    }
    if (waiting) yield { partialListing: true };
  },
};
