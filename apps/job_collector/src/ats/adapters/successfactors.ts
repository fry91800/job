import type { CollectedOffer, ContractType } from "@job/shared";
import { parse } from "node-html-parser";
import { collectorConfig } from "../../config";
import type { CollectedRecord } from "../../connectors/types";
import { CrawlError, crawlGet, PageGoneError } from "../../crawler/fetcher";
import { refreshDue, type AtsAdapter, type StillListed } from "../adapter";
import { NotFoundError } from "../http";
import { contractFrom, remoteFrom, salaryFromText } from "../mapping";

// SAP SuccessFactors career sites ("Career Site Builder"), on the employer's own host
// (jobs.engie.com, careers.capgemini.com, jobsearch.alstom.com, jobs.atos.net). Large
// employers (COLLECTOR.md §17.12). Checked 2026-10-18 on Engie, Alstom, Capgemini, Atos:
// * robots.txt only closes /services/ (the RSS feed), /applybutton/, /talentcommunity/…;
// * /googlefeed.xml: every offer of the site in one RSS file meant for Google ("g:" fields:
//   g:id, g:location "Paris, FR, 75001" / "Semeac, 65, FR", g:employer, the full
//   description); no publication date (g:expiration_date is always 30 days ahead);
// * search and category pages are built in the browser; offer pages
//   (/job/{place-title}/{id}/) come in two layouts: "joblayouttoken" blocks with labels the
//   employer chooses ("Publié le:", "Date:", "Type de contrat:"…; Engie, Capgemini, Atos),
//   or the older one with schema.org fields (<meta itemprop="datePosted" content="Mon Sep 21
//   00:00:00 UTC 2026">; Alstom).
// The feed gives the list (offers missing from it are closed) and the content; a new French
// offer's page is read once for its publication date and contract, within the crawler's
// page budget per run (offers left without a date get it at a later run).

const SOURCE = "successfactors";
const FEED_PATH = "/googlefeed.xml";

type FeedItem = { id: string; title: string; url: string; location: string; employer: string | null; description: string };

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (text: string) =>
  text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (entity, code: string) =>
    code[0] === "#" ? String.fromCodePoint(code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : Number(code.slice(1))) : (ENTITIES[code.toLowerCase()] ?? entity),
  );

// An XML element's text: CDATA as is, else unescaped once.
function field(item: string, name: string): string | null {
  const match = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(item);
  if (!match) return null;
  const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(match[1]);
  return cdata ? cdata[1] : decode(match[1]);
}

export function parseFeed(xml: string): FeedItem[] {
  const items: FeedItem[] = [];
  for (const [, item] of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const id = field(item, "g:id")?.trim();
    const url = field(item, "link")?.trim();
    const location = field(item, "g:location")?.trim() ?? "";
    let title = field(item, "title")?.trim() ?? "";
    if (!id || !url || !title) continue;
    // The title ends with the place in brackets: "Technicien (F/H) (Paris, FR, 75001)".
    if (location && title.endsWith(`(${location})`)) title = title.slice(0, -location.length - 2).trim();
    // The description is HTML escaped inside the CDATA ("&lt;p&gt;…").
    let description = field(item, "description") ?? "";
    if (/^\s*&lt;/.test(description)) description = decode(description);
    items.push({ id, title, url, location, employer: field(item, "g:employer")?.trim() || null, description });
  }
  return items;
}

// "Paris, FR, 75001", "Semeac, 65, FR", "Crespin, FR", "Lyon, Auvergne-Rhône-Alpes, FR":
// in France when one part is "FR" or "France".
export function franceLocation(location: string): { city: string | null; postcode: string | null; countyCode: string | null } | null {
  const parts = location.split(",").map((part) => part.trim()).filter(Boolean);
  if (!parts.some((part) => part === "FR" || /^france$/i.test(part))) return null;
  const postcode = parts.find((part) => /^\d{5}$/.test(part)) ?? null;
  const county = parts.find((part) => /^(\d{2}|2[AB]|97\d)$/i.test(part)) ?? null;
  const city = parts[0] && parts[0] !== "FR" && !/^france$/i.test(parts[0]) ? parts[0] : null;
  return { city, postcode, countyCode: county?.toUpperCase() ?? (postcode ? (postcode.startsWith("97") ? postcode.slice(0, 3) : postcode.slice(0, 2)) : null) };
}

const MONTHS: Record<string, number> = {
  janv: 1, jan: 1, janvier: 1, févr: 2, fevr: 2, feb: 2, février: 2, fevrier: 2, mars: 3, mar: 3, avr: 4, apr: 4, avril: 4, mai: 5, may: 5,
  juin: 6, jun: 6, juil: 7, jul: 7, juillet: 7, août: 8, aout: 8, aug: 8, sept: 9, sep: 9, septembre: 9, oct: 10, octobre: 10, nov: 11, novembre: 11, déc: 12, dec: 12, décembre: 12, decembre: 12,
};

// "12/01/2026" (day first, except on English US pages), "2026-01-12", "12 janv. 2026",
// "Jan 12, 2026" → "2026-01-12".
export function pageDate(text: string, lang: string): string | null {
  const iso = (year: number, month: number, day: number) =>
    year > 2000 && month >= 1 && month <= 12 && day >= 1 && day <= 31 ? `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` : null;
  let match = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
  if (match) return iso(+match[1], +match[2], +match[3]);
  match = /(\d{1,2})[/.](\d{1,2})[/.](\d{4})/.exec(text);
  if (match) return /^en-US/i.test(lang) ? iso(+match[3], +match[1], +match[2]) : iso(+match[3], +match[2], +match[1]);
  match = /(\d{1,2})\s+([a-zéû]+)\.?\s+(\d{4})/i.exec(text);
  if (match && MONTHS[match[2].toLowerCase()]) return iso(+match[3], MONTHS[match[2].toLowerCase()], +match[1]);
  match = /([a-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})/i.exec(text);
  if (match && MONTHS[match[1].toLowerCase()]) return iso(+match[3], MONTHS[match[1].toLowerCase()], +match[2]);
  // "Mon Sep 21 00:00:00 UTC 2026" (the older layout's datePosted).
  match = /([a-z]{3})\s+(\d{1,2})\s+[\d:]+\s+\w+\s+(\d{4})/i.exec(text);
  if (match && MONTHS[match[1].toLowerCase()]) return iso(+match[3], MONTHS[match[1].toLowerCase()], +match[2]);
  return null;
}

// The labelled fields of an offer page ("joblayouttoken" blocks): publication date,
// contract, pay.
export function pageDetails(html: string): { publishedAt: string | null; contract: string | null; pay: string | null; values: string[] } {
  const root = parse(html);
  const lang = root.querySelector("html")?.getAttribute("lang") ?? "fr-FR";
  const tokens = root.querySelectorAll(".joblayouttoken").map((token) => ({
    label: token.querySelector(".joblayouttoken-label")?.text.replace(/\s+/g, " ").trim() ?? "",
    value: token.querySelector("span[lang], .rtltextaligneligible")?.text.replace(/\s+/g, " ").trim() ?? "",
  }));
  const labelled = (pattern: RegExp) => tokens.find((token) => token.label && pattern.test(token.label) && token.value)?.value ?? null;
  const date = labelled(/publi|posted|date/i) ?? root.querySelector('meta[itemprop="datePosted"]')?.getAttribute("content") ?? root.querySelector("#job-date")?.text ?? null;
  const values = tokens.map((token) => token.value).filter((value) => value && value.length <= 80);
  const pay = tokens.filter((token) => /salaire|salary|r[ée]mun[ée]ration|pay\b/i.test(token.label) && token.value).map((token) => token.value);
  return {
    publishedAt: date ? pageDate(date, lang) : null,
    contract: labelled(/contrat|contract|type d.emploi|employment type/i) ?? values.find((value) => contractFrom(value) !== null) ?? null,
    pay: pay.length ? pay.join(" - ") : null,
    values,
  };
}

// The contract from the description, only from unambiguous words ("stage" can mean a phase
// of a project, "intérim" an interim manager): CDI, CDD, alternance.
export function descriptionContract(html: string): ContractType | null {
  const text = html.replace(/<[^>]+>/g, " ");
  if (/\bCDI\b|dur[ée]e ind[ée]termin[ée]e/i.test(text)) return "permanent";
  if (/\bCDD\b|dur[ée]e d[ée]termin[ée]e/i.test(text)) return "fixed_term";
  if (/\ben alternance\b|contrat d.apprentissage|contrat de professionnalisation/i.test(text)) return "apprenticeship";
  return null;
}

// "jobs.engie.com" → "Engie", "jobsearch.alstom.com" → "Alstom".
export function companyFromHost(host: string): string {
  const labels = host.toLowerCase().replace(/^www\./, "").split(".");
  const name = labels.length > 2 ? labels[labels.length - 2] : labels[0];
  return name.charAt(0).toUpperCase() + name.slice(1);
}

async function feed(slug: string): Promise<FeedItem[]> {
  const { feedMaxBytes, feedTimeoutMs } = collectorConfig.successFactors;
  try {
    const page = await crawlGet(`${collectorConfig.crawler.scheme}://${slug}${FEED_PATH}`, { maxBytes: feedMaxBytes, timeoutMs: feedTimeoutMs });
    if (!/<rss[\s>]/.test(page.text.slice(0, 2000))) throw new NotFoundError(`${slug}: no SuccessFactors job feed`);
    return parseFeed(page.text);
  } catch (error) {
    if (error instanceof PageGoneError) throw new NotFoundError(error.message);
    throw error;
  }
}

function toOffer(slug: string, companyName: string, item: FeedItem, place: NonNullable<ReturnType<typeof franceLocation>>, details: ReturnType<typeof pageDetails> | null, publishedAt: string | null): CollectedOffer {
  return {
    contractVersion: 1,
    source: SOURCE,
    externalId: `${slug}:${item.id}`,
    url: item.url,
    applyUrl: null,
    title: item.title,
    company: { name: companyName, atsSlug: slug },
    location: { raw: item.location, city: place.city, postcode: place.postcode, countyCode: place.countyCode, countryCode: "FR" },
    remote: remoteFrom(item.title, ...(details?.values ?? [])),
    contractType: contractFrom(details?.contract, item.title) ?? descriptionContract(item.description),
    salary: salaryFromText(details?.pay ?? null),
    description: { format: "html", content: item.description || item.title },
    publishedAt: publishedAt ? `${publishedAt}T00:00:00.000Z` : null,
    collectedAt: new Date().toISOString(),
  };
}

export const successFactors: AtsAdapter = {
  ats: SOURCE,
  kind: "crawler",
  schedule: "30 4 * * *", // daily, like the career sites
  // No common address: boards are added from `inspect` (j2w.init on the page) or by hand.

  async check(slug) {
    const items = await feed(slug);
    return { companyName: companyFromHost(slug), jobCount: items.length, franceJobCount: items.filter((item) => franceLocation(item.location)).length };
  },

  async *collect(slug, companyName, known): AsyncGenerator<CollectedRecord | StillListed> {
    const items = await feed(slug);
    let pagesRead = 0;
    let failures = 0;
    for (const item of items) {
      const place = franceLocation(item.location);
      if (!place) continue;
      const externalId = `${slug}:${item.id}`;
      const knownDate = known?.get(externalId);
      // Known with its date: still listed, or rebuilt from the feed on its refresh day.
      if (knownDate) {
        if (!refreshDue(externalId)) {
          yield { stillListed: externalId };
          continue;
        }
        yield { raw: { url: item.url, releasedDate: knownDate, location: item.location, employer: item.employer }, offer: toOffer(slug, companyName, item, place, null, knownDate) };
        continue;
      }
      // New, or known without a date: its page, within the budget of pages per run.
      if (pagesRead >= collectorConfig.crawler.maxOfferPagesPerRun) {
        if (known?.has(externalId)) {
          yield { stillListed: externalId };
          continue;
        }
        yield { raw: { url: item.url, releasedDate: null, location: item.location, employer: item.employer }, offer: toOffer(slug, companyName, item, place, null, null) };
        continue;
      }
      pagesRead++;
      let details: ReturnType<typeof pageDetails> | null = null;
      try {
        details = pageDetails((await crawlGet(item.url)).text);
        failures = 0;
      } catch (error) {
        if (!(error instanceof CrawlError)) throw error;
        if (error instanceof PageGoneError) continue; // removed since the feed was made
        // Several failures in a row: the site is failing, stop (nothing gets closed).
        if (++failures >= 5) throw error;
      }
      const publishedAt = details?.publishedAt ?? null;
      yield { raw: { url: item.url, releasedDate: publishedAt, location: item.location, employer: item.employer }, offer: toOffer(slug, companyName, item, place, details, publishedAt) };
    }
  },
};
