import { parse } from "node-html-parser";
import { collectorConfig } from "../config";
import { allowedByRobots, CrawlError, crawlGet, robotsFor } from "./fetcher";

// Finds a career site's offer pages: from its sitemaps (robots.txt "Sitemap:" lines, else
// /sitemap.xml), else by following its links from the start page. Only addresses that
// look like offer pages are kept; the JobPosting markup on the page confirms it later.

export type OfferPage = { url: string; key: string; lastmod: string | null };

// Path words of career pages, in French and English.
const JOB_WORDS = /(^|[/_-])(jobs?|offres?|offre-d-emploi|emplois?|careers?|carrieres?|postes?|vacanc\w*|positions?|annonces?|recrutement|opportunit\w*|openings?|joboffers?|stellen)([/_-]|$)/i;

// "/fr/jobs/123-dev" and "/en/jobs/123-dev" are the same offer: the language prefix is
// dropped from its key, French kept when there is a choice.
const LOCALE = /^\/([a-z]{2})(-[a-z]{2})?(?=\/)/i;

export function pageKey(url: URL): string {
  return (url.pathname.replace(LOCALE, "") || "/") + url.search;
}

// An offer page: a job word in the path followed by at least one more segment (the
// listing "/jobs" itself is not an offer).
export function looksLikeOfferPage(url: URL): boolean {
  const segments = url.pathname.replace(LOCALE, "").split("/").filter(Boolean);
  const index = segments.findIndex((segment) => JOB_WORDS.test(`/${segment}/`));
  return index !== -1 && index < segments.length - 1 && !/\.(pdf|jpe?g|png|gif|svg|xml|css|js)$/i.test(url.pathname);
}

const decodeXml = (value: string) =>
  value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").trim();

export function parseSitemap(xml: string): { sitemaps: string[]; urls: { loc: string; lastmod: string | null }[] } {
  const sitemaps = [...xml.matchAll(/<sitemap\b[^>]*>([\s\S]*?)<\/sitemap>/gi)]
    .map((match) => /<loc>([\s\S]*?)<\/loc>/i.exec(match[1])?.[1])
    .filter((loc): loc is string => !!loc)
    .map(decodeXml);
  const urls = [...xml.matchAll(/<url\b[^>]*>([\s\S]*?)<\/url>/gi)].flatMap((match) => {
    const loc = /<loc>([\s\S]*?)<\/loc>/i.exec(match[1])?.[1];
    const lastmod = /<lastmod>([\s\S]*?)<\/lastmod>/i.exec(match[1])?.[1];
    return loc ? [{ loc: decodeXml(loc), lastmod: lastmod ? decodeXml(lastmod) : null }] : [];
  });
  return { sitemaps, urls };
}

// Same site: same registered domain (jobs.x.com redirecting to careers.x.com). Two-level
// suffixes (co.uk) are rare for French sites and only make this wider.
const domainOf = (host: string) => host.split(".").slice(-2).join(".");
const sameSite = (url: URL, start: URL) => domainOf(url.hostname) === domainOf(start.hostname);

function addPage(pages: Map<string, OfferPage>, url: URL, lastmod: string | null) {
  const key = pageKey(url);
  const existing = pages.get(key);
  const french = LOCALE.exec(url.pathname)?.[1]?.toLowerCase() === "fr";
  if (!existing || french) pages.set(key, { url: url.toString(), key, lastmod });
}

// The sitemaps to read. A start with a path ("orange.jobs/fr/fr", one country of a site
// with a sitemap per country and language, like Phenom's) reads only those under it; else
// French ones first ("/fr/fr/sitemap_index.xml" before "/gb/en/…").
function startSitemaps(start: URL, listed: string[]): string[] {
  const section = start.pathname.replace(/\/?$/, "/");
  if (section !== "/") {
    const inside = listed.filter((loc) => {
      try {
        return new URL(loc).pathname.startsWith(section);
      } catch {
        return false;
      }
    });
    return inside.length ? inside : [new URL("sitemap_index.xml", `${start.origin}${section}`).toString(), new URL("sitemap.xml", `${start.origin}${section}`).toString()];
  }
  if (!listed.length) return [new URL("/sitemap.xml", start).toString()];
  const french = (loc: string) => /\/fr([-_][a-z]{2})?\//i.test(loc);
  return [...listed.filter(french), ...listed.filter((loc) => !french(loc))];
}

async function fromSitemaps(start: URL): Promise<Map<string, OfferPage> | null> {
  const { maxSitemaps, maxSitemapUrls } = collectorConfig.crawler;
  const robots = await robotsFor(start);
  const queue = startSitemaps(start, robots.sitemaps);
  const pages = new Map<string, OfferPage>();
  let read = 0;
  let urlCount = 0;
  while (queue.length && read < maxSitemaps && urlCount < maxSitemapUrls) {
    const next = queue.shift()!;
    let xml: string;
    try {
      xml = (await crawlGet(next)).text;
    } catch (error) {
      if (error instanceof CrawlError) continue;
      throw error;
    }
    read++;
    const parsed = parseSitemap(xml);
    // Child sitemaps may be relative to their index ("sitemap-jobs.xml": Lidl).
    const sitemaps = parsed.sitemaps.flatMap((loc) => {
      try {
        return [new URL(loc, next).toString()];
      } catch {
        return [];
      }
    });
    const { urls } = parsed;
    // Job sitemaps first ("sitemap-jobs.xml").
    queue.push(...sitemaps.filter((loc) => /job|offre|emploi|career|carriere|poste|vacanc/i.test(loc)), ...sitemaps.filter((loc) => !/job|offre|emploi|career|carriere|poste|vacanc/i.test(loc)));
    for (const { loc, lastmod } of urls) {
      urlCount++;
      let url: URL;
      try {
        url = new URL(loc);
      } catch {
        continue;
      }
      if (sameSite(url, start) && looksLikeOfferPage(url)) addPage(pages, url, lastmod);
    }
  }
  return read > 0 ? pages : null;
}

// No sitemap: links from the start page, following listing pages ("/jobs?page=2") a little.
// `section`: the start is one company's part of a site shared by many (join.com/companies/x):
// only addresses under it count, and any deeper address may be an offer.
async function fromLinks(start: URL, section = false): Promise<Map<string, OfferPage>> {
  const sectionPath = start.pathname.replace(/\/?$/, "/");
  const depth = start.pathname.split("/").filter(Boolean).length;
  const pages = new Map<string, OfferPage>();
  const seen = new Set<string>([start.toString()]);
  const queue = [start.toString()];
  let read = 0;
  while (queue.length && read < collectorConfig.crawler.maxListingPages) {
    const next = queue.shift()!;
    let html: string;
    let base: string;
    try {
      ({ text: html, url: base } = await crawlGet(next));
    } catch (error) {
      if (error instanceof CrawlError && read > 0) continue;
      throw error;
    }
    read++;
    for (const anchor of parse(html).querySelectorAll("a[href]")) {
      let url: URL;
      try {
        url = new URL(anchor.getAttribute("href")!, base);
      } catch {
        continue;
      }
      url.hash = "";
      if (!/^https?:$/.test(url.protocol) || !sameSite(url, start) || seen.has(url.toString())) continue;
      if (section && (url.host !== start.host || !url.pathname.startsWith(sectionPath))) continue;
      seen.add(url.toString());
      if (looksLikeOfferPage(url)) addPage(pages, url, null);
      else if (JOB_WORDS.test(url.pathname) || /[?&]page=\d+/.test(url.search)) queue.push(url.toString());
      else if (section && url.pathname.split("/").filter(Boolean).length > depth) addPage(pages, url, null);
    }
  }
  return pages;
}

// `section`: see fromLinks. The shared site's sitemaps list every company: not read.
export async function findOfferPages(startUrl: string, options: { section?: boolean } = {}): Promise<OfferPage[]> {
  const start = new URL(startUrl);
  const fromSitemap = options.section ? null : await fromSitemaps(start);
  const pages = fromSitemap && fromSitemap.size > 0 ? fromSitemap : await fromLinks(start, options.section);
  // Pages robots.txt forbids aren't offers we can read (sitemaps may still list them),
  // unless robots.txt rules are ignored by configuration.
  const robots = await robotsFor(start);
  const allowed = [...pages.values()].filter((page) => {
    const url = new URL(page.url);
    return url.host !== start.host || allowedByRobots(robots, url);
  });
  // Single offers first: a check samples the first pages, and a run's page budget goes to
  // offers before listings and advice pages that also have "job" in their address.
  return allowed.map((page, index) => ({ page, index, score: offerScore(new URL(page.url)) })).sort((a, b) => b.score - a.score || a.index - b.index).map((item) => item.page);
}

// How much an address looks like one offer (and a French one): an id (a run of digits, or a reference like
// "260002H8") and a segment naming offers ("/job/", "/offres-d-emploi/") count for it;
// listing and editorial segments ("/category/", "/location/", "/tips-candidates/",
// "-jobs/") against it.
const OFFER_SEGMENT = /^(jobs?|job-?offers?|offres?(-d-emploi)?|emplois?|joboffers?|postes?|vacanc\w*|positions?|annonces?|stellen)$/i;
const LISTING_SEGMENT = /^(category|categories|location|locations|employment|business|tips?(-\w+)?|conseils?(-\w+)?|metiers?|blog|news|actualites?|events?|evenements?|search(-\w+)?|recherche(-\w+)?|teams?|equipes?)$|-jobs$|-emplois$/i;

export function offerScore(url: URL): number {
  const segments = url.pathname.replace(LOCALE, "").split("/").filter(Boolean).map((segment) => decodeURIComponent(segment));
  let score = 0;
  if (segments.some((segment) => OFFER_SEGMENT.test(segment))) score += 2;
  const last = segments.at(-1) ?? "";
  if (/\d{5,}/.test(last) || /(^|[-_])[A-Z0-9]*\d[A-Z0-9]{5,}([-_]|$)/i.test(last) || /\d{4,}/.test(segments.at(-2) ?? "")) score += 2;
  if (segments.some((segment) => LISTING_SEGMENT.test(segment))) score -= 4;
  // French-looking addresses first: on international sites, French offers.
  const path = url.pathname.toLowerCase();
  if (/^\/fr([-_][a-z]{2})?\//.test(path) || /[-_]fr\/?$/.test(path) || /offres?-d-emploi|emplois?|alternance|stage|\bcdi\b|\bcdd\b|[-_]h-f\b|[-_]f-h\b/.test(path)) score += 1;
  return score;
}
