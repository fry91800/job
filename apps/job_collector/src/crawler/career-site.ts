import { refreshDue, type AtsAdapter, type StillListed } from "../ats/adapter";
import { NotFoundError } from "../ats/http";
import { collectorConfig } from "../config";
import type { CollectedRecord } from "../connectors/types";
import { findOfferPages } from "./discover-pages";
import { CrawlError, crawlGet, PageGoneError } from "./fetcher";
import { normalizeCompanyName } from "../pipeline/text";
import { extractJobPostings, frenchPlace, jobPostingOffer } from "./job-posting";

// Career sites publishing schema.org JobPosting (COLLECTOR.md §5.3), as boards of the
// company registry: ats "careersite", slug = the start address without "https://"
// ("careers.example.com" or "example.com/carrieres"). Offer pages come from the sitemaps
// (else the site's links); an offer whose page and sitemap date didn't change is only
// marked as still listed, and fetched again about once a week.

const SOURCE = "careersite";

// Pages read without a French JobPosting (other countries, not an offer), by page key →
// sitemap date: skipped while unchanged, for as long as the worker runs.
const notOffers = new Map<string, string | null>();

const startUrl = (slug: string) => `${collectorConfig.crawler.scheme}://${slug}`;

// A site that can't be read at all is "gone" for the registry (status invalid).
async function offerPages(slug: string) {
  try {
    return await findOfferPages(startUrl(slug), { section: COMPANY_SECTIONS.some(([host, path]) => slug.startsWith(`${host}${path}`)) });
  } catch (error) {
    if (error instanceof PageGoneError) throw new NotFoundError(error.message);
    throw error;
  }
}

// Recruiting tools whose public job pages carry JobPosting (checked 2026-10-16, COLLECTOR.md
// §17): their companies' career sites are found by discovery like the ATS boards; other
// career sites are added by hand. One host per company ({company}.teamtailor.com), or one
// section of a shared site (join.com/companies/{company}, see crawler.sharedHosts).
const NOT_SITES = new Set(["www", "app", "api", "docs", "support", "help", "status", "partner", "partners", "assets", "blog", "go", "jobs", "careers", "team", "login", "community", "developer", "cdn"]);
// iCIMS's classic sites ("careers-x.icims.com", COLLECTOR.md §17.23): sitemaps and JobPosting.
const COMPANY_HOSTS = ["teamtailor.com", "jobs.personio.de", "jobs.personio.com", "welcomekit.co", "icims.com"];
const COMPANY_SECTIONS: [host: string, path: string][] = [
  ["join.com", "/companies/"],
  ["jobs.jobvite.com", "/"],
];
const COMPANY_ID = /^[a-z0-9][a-z0-9-]{0,62}$/;

export function careerSiteFromUrl(url: URL): string | null {
  const host = url.hostname.toLowerCase();
  for (const domain of COMPANY_HOSTS) {
    if (!host.endsWith(`.${domain}`)) continue;
    const sub = host.slice(0, -domain.length - 1);
    return COMPANY_ID.test(sub) && !NOT_SITES.has(sub) ? host : null;
  }
  for (const [sectionHost, path] of COMPANY_SECTIONS) {
    if (host !== sectionHost || !url.pathname.startsWith(path)) continue;
    const company = url.pathname.slice(path.length).split("/")[0]?.toLowerCase();
    return company && COMPANY_ID.test(company) && !NOT_SITES.has(company) ? `${host}${path}${company}` : null;
  }
  return null;
}

export const careerSite: AtsAdapter = {
  ats: SOURCE,
  kind: "crawler",
  schedule: "0 5 * * *", // daily: slower and more polite than the ATS APIs
  discovery: {
    prefixes: [...COMPANY_HOSTS.map((domain) => `*.${domain}`), ...COMPANY_SECTIONS.map(([host, path]) => `${host}${path}`)],
    slugFromUrl: careerSiteFromUrl,
  },

  async check(slug) {
    const pages = await offerPages(slug);
    let postings = 0;
    let french = 0;
    let companyName: string | null = null;
    // A few pages; more (up to checkMaxPages) while none is in France, spread over the whole
    // list: an international site may list its offers by place, abroad first (Société
    // Générale: Montréal).
    const { checkSamplePages, checkMaxPages } = collectorConfig.crawler;
    const spread = pages.length > checkMaxPages ? Array.from({ length: checkMaxPages - checkSamplePages }, (_, index) => pages[checkSamplePages + Math.floor(((index + 1) * (pages.length - checkSamplePages)) / (checkMaxPages - checkSamplePages + 1))]) : pages.slice(checkSamplePages);
    let read = 0;
    for (const page of [...pages.slice(0, checkSamplePages), ...spread]) {
      if (read >= checkMaxPages || (read >= checkSamplePages && french > 0)) break;
      read++;
      try {
        const found = extractJobPostings((await crawlGet(page.url)).text);
        postings += found.length;
        french += found.filter((posting) => frenchPlace(posting)).length;
        companyName ??= found.map((posting) => (posting.hiringOrganization as { name?: string } | undefined)?.name ?? null).find(Boolean) ?? null;
      } catch (error) {
        if (!(error instanceof CrawlError)) throw error;
      }
    }
    // Without JobPosting markup the site can't be collected: "empty".
    if (postings === 0) return { companyName, jobCount: 0, franceJobCount: 0 };
    return { companyName, jobCount: pages.length, franceJobCount: french ? Math.max(french, Math.round((pages.length * french) / postings)) : 0 };
  },

  async *collect(slug, companyName, known): AsyncGenerator<CollectedRecord | StillListed> {
    const pages = await offerPages(slug);
    let fetched = 0;
    let failures = 0;
    for (const page of pages) {
      const externalId = `${slug}:${page.key}`.slice(0, 200);
      const unchanged = (stored: string | null | undefined) => stored === page.lastmod && !refreshDue(externalId);
      if (known?.has(externalId) && unchanged(known.get(externalId))) {
        yield { stillListed: externalId };
        continue;
      }
      if (notOffers.has(externalId) && unchanged(notOffers.get(externalId))) continue;
      // Per-run limit: known offers stay open, new ones wait for the next run.
      if (fetched >= collectorConfig.crawler.maxOfferPagesPerRun) {
        if (known?.has(externalId)) yield { stillListed: externalId };
        continue;
      }

      fetched++;
      let html: string;
      let url: string;
      try {
        ({ text: html, url } = await crawlGet(page.url));
        failures = 0;
      } catch (error) {
        if (!(error instanceof CrawlError)) throw error;
        if (error instanceof PageGoneError) continue;
        // Several failures in a row: the site is failing, stop (nothing gets closed).
        if (++failures >= 5) throw error;
        if (known?.has(externalId)) yield { stillListed: externalId };
        continue;
      }

      const postings = extractJobPostings(html)
        .map((posting) => ({ posting, place: frenchPlace(posting) }))
        .filter((item) => item.place !== null);
      if (postings.length === 0) {
        notOffers.set(externalId, page.lastmod);
        continue;
      }
      notOffers.delete(externalId);
      // A page with several offers (rare): one record each.
      for (const [index, { posting, place }] of postings.entries()) {
        const key = postings.length > 1 ? `${page.key}#${index + 1}` : page.key;
        const offer = jobPostingOffer(posting, { url, key, source: SOURCE, siteSlug: slug, place: place! });
        // A branch of the board's company ("CRIT LUNEL" on Crit's site) is shown as the company.
        const branch = offer.company && normalizeCompanyName(offer.company.name).startsWith(`${normalizeCompanyName(companyName)} `);
        offer.company = branch || !offer.company ? { ...offer.company, name: companyName } : offer.company;
        yield { raw: { url, releasedDate: page.lastmod, jobPosting: posting }, offer };
      }
    }
  },
};

// Tests.
export function resetCareerSiteMemory(): void {
  notOffers.clear();
}
