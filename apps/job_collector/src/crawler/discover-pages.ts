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

async function fromSitemaps(start: URL): Promise<Map<string, OfferPage> | null> {
  const { maxSitemaps, maxSitemapUrls } = collectorConfig.crawler;
  const robots = await robotsFor(start);
  const queue = robots.sitemaps.length ? [...robots.sitemaps] : [new URL("/sitemap.xml", start).toString()];
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
    const { sitemaps, urls } = parseSitemap(xml);
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
async function fromLinks(start: URL): Promise<Map<string, OfferPage>> {
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
      seen.add(url.toString());
      if (looksLikeOfferPage(url)) addPage(pages, url, null);
      else if (JOB_WORDS.test(url.pathname) || /[?&]page=\d+/.test(url.search)) queue.push(url.toString());
    }
  }
  return pages;
}

export async function findOfferPages(startUrl: string): Promise<OfferPage[]> {
  const start = new URL(startUrl);
  const fromSitemap = await fromSitemaps(start);
  const pages = fromSitemap && fromSitemap.size > 0 ? fromSitemap : await fromLinks(start);
  // Pages robots.txt forbids aren't offers we can read (sitemaps may still list them),
  // unless robots.txt rules are ignored by configuration.
  const robots = await robotsFor(start);
  return [...pages.values()].filter((page) => {
    const url = new URL(page.url);
    return url.host !== start.host || allowedByRobots(robots, url);
  });
}
