import type { CollectedOffer, ContractType } from "@job/shared";
import { parse } from "node-html-parser";
import { collectorConfig } from "../../config";
import type { CollectedRecord } from "../../connectors/types";
import { CrawlError, crawlGet, PageGoneError } from "../../crawler/fetcher";
import { refreshDue, type AtsAdapter, type PartialListing, type StillListed } from "../adapter";
import { NotFoundError } from "../http";
import { contractFrom, frenchCity, isFranceCountry } from "../mapping";

// Gestmax career sites (COLLECTOR.md §17.21): board = the site's host,
// "kiloutou.gestmax.fr". French employers and local authorities. Checked 2026-10-19 on
// Kiloutou, Île-de-France region, Expertise France, Ville de Lille:
// * no robots.txt (everything allowed);
// * /search leads (sometimes through a redirect, "/search/1-liste-d-offres") to the list of
//   all offers, about 20 a page, with page links ("/search/index/page/2",
//   "?page=2", "/search/index/frontsearchtab_id/1/page/2");
// * offers are https://{host}/{id}/{n}/{words}; list cards may carry the contract, the place
//   and the date (dd/mm/yyyy), depending on the site's template;
// * offer pages have no JobPosting: the title in <h1>, the city in .title-city on some
//   templates, labelled fields (<p class="field-vac_…"><span>Label</span><br>value</p>) and
//   the texts under headings (h3.field + .field-value-…).
// Most sites only post in France; some (Expertise France) post abroad, with a country field.
// The list is complete: offers missing from it are closed. A new offer's page is read once,
// within the page budget per run.

const SOURCE = "gestmax";

type Listed = { id: string; url: string; title: string | null; date: string | null; contract: string | null; place: string | null };
type Field = { label: string; value: string };

const skipped = new Map<string, string | null>();

const clean = (text: string | undefined | null) => (text ?? "").replace(/\s+/g, " ").trim();
// "16/10/2026" → "2026-10-16"; a date ahead is a closing date, not the publication's.
const frenchDate = (text: string | null | undefined) => {
  const match = /(\d{2})\/(\d{2})\/(\d{4})/.exec(text ?? "");
  const date = match ? `${match[3]}-${match[2]}-${match[1]}` : null;
  return date && date <= new Date().toISOString().slice(0, 10) ? date : null;
};

// The offers of one list page, and the highest page number its links name.
export function gestmaxListPage(html: string, origin: string): { offers: Listed[]; lastPage: number; pageLink: string | null } {
  const root = parse(html);
  const offers: Listed[] = [];
  const host = new URL(origin).host;
  const offerPath = /^\/(\d+)\/\d+\/[^/?#]+/;
  // Table templates (MBDA): a row per offer, a cell per column.
  for (const row of root.querySelectorAll('tr[class*="vacancy-id-"]')) {
    const link = row.querySelector("a[href]");
    const url = link ? new URL(link.getAttribute("href")!, origin) : null;
    const match = url && url.host === host ? offerPath.exec(url.pathname) : null;
    const cell = (pattern: RegExp) => clean(row.querySelectorAll("td").find((item) => pattern.test(item.getAttribute("class") ?? ""))?.text) || null;
    const title = cell(/col_vacancy_title/);
    if (!url || !match || !title || offers.some((offer) => offer.id === match[1])) continue;
    offers.push({
      id: match[1],
      url: `${origin}${url.pathname.replace(/\/fr_FR$/, "")}`,
      title,
      date: frenchDate(cell(/col_vac(ancy)?_(activation_)?date/)),
      contract: cell(/col_vac_(job_type|contrat|type_contrat)/),
      place: cell(/col_vac_(localisation|lieu|residence|ville|site)/),
    });
  }
  for (const link of root.querySelectorAll("a[href]")) {
    let url: URL;
    try {
      url = new URL(link.getAttribute("href")!, origin);
    } catch {
      continue;
    }
    const match = offerPath.exec(url.pathname);
    if (url.host !== host || !match || offers.some((offer) => offer.id === match[1])) continue;
    const title = clean(link.querySelector("h3, h2, .list-group-item-heading")?.text.replace(/\(Nouvelle fenêtre\)/i, ""));
    if (!title) continue;
    const span = (pattern: RegExp) => clean(link.querySelectorAll("span").find((item) => pattern.test(item.getAttribute("class") ?? ""))?.text) || null;
    offers.push({
      id: match[1],
      url: `${origin}${url.pathname.replace(/\/fr_FR$/, "")}`,
      title,
      date: frenchDate(link.querySelector(".listdiv-date")?.text),
      contract: span(/job_type|contrat/),
      place: span(/lieu|localisation|ville|city|site/),
    });
  }
  let lastPage = 1;
  let pageLink: string | null = null;
  for (const link of root.querySelectorAll("a[href]")) {
    const href = link.getAttribute("href")!;
    const number = /(?:\/page\/|[?&]page=)(\d+)/.exec(href)?.[1];
    if (number && Number(number) >= lastPage && !/\/\d+\/\d+\//.test(href)) {
      lastPage = Number(number);
      pageLink = href;
    }
  }
  return { offers, lastPage, pageLink };
}

async function listOffers(slug: string): Promise<{ offers: Listed[]; complete: boolean }> {
  let first: { url: string; text: string };
  try {
    first = await crawlGet(`${collectorConfig.crawler.scheme}://${slug}/search`);
  } catch (error) {
    if (error instanceof PageGoneError) throw new NotFoundError(error.message);
    throw error;
  }
  const origin = new URL(first.url).origin;
  if (!/gestmax/i.test(first.text)) throw new NotFoundError(`${slug}: not a Gestmax site`);
  const page = gestmaxListPage(first.text, origin);
  const offers = new Map(page.offers.map((offer) => [offer.id, offer]));
  const last = Math.min(page.lastPage, collectorConfig.gestmax.maxListPages);
  for (let number = 2; number <= last && page.pageLink; number++) {
    const address = new URL(page.pageLink.replace(/(\/page\/|[?&]page=)\d+/, `$1${number}`), first.url).toString();
    const next = gestmaxListPage((await crawlGet(address)).text, origin);
    if (!next.offers.length) break;
    for (const offer of next.offers) offers.set(offer.id, offer);
  }
  return { offers: [...offers.values()], complete: page.lastPage <= collectorConfig.gestmax.maxListPages };
}

export function gestmaxPage(html: string): { title: string | null; city: string | null; fields: Field[]; description: string } {
  const root = parse(html);
  const fields: Field[] = [];
  for (const node of root.querySelectorAll('p[class^="field-"], div[class^="field-"]')) {
    const label = clean(node.querySelector("span, strong, label")?.text);
    const value = clean(node.text.replace(label, ""));
    if (label && value) fields.push({ label, value });
  }
  const parts: string[] = [];
  const intro = root.querySelector(".vacancy-presentation");
  intro?.querySelector(".vacancy-presentation-logos")?.remove();
  if (clean(intro?.text).length > 80) parts.push(intro!.innerHTML.trim());
  for (const value of root.querySelectorAll('[class*="field-value-"]')) {
    if (/cust_footer/.test(value.getAttribute("class") ?? "") || clean(value.text).length < 2) continue;
    const heading = value.previousElementSibling;
    if (heading && /\bfield\b/.test(heading.getAttribute("class") ?? "") && clean(heading.text)) parts.push(`<h3>${clean(heading.text)}</h3>`);
    parts.push(value.innerHTML.trim());
  }
  const title = clean(root.querySelector("h1")?.text) || clean(root.querySelector('meta[property="og:title"]')?.getAttribute("content")) || null;
  return { title, city: clean(root.querySelector(".title-city")?.text) || null, fields, description: parts.join("") };
}

const CONTRACTS: [RegExp, ContractType][] = [
  [/alternance|apprentissage|professionnalisation/i, "apprenticeship"],
  [/stage|stagiaire/i, "internship"],
  [/\bcdi\b|ind[ée]termin|titulaire|permanent/i, "permanent"],
  [/\bcdd\b|d[ée]termin|contractuel|vacataire|remplacement|int[ée]rim/i, "fixed_term"],
];

// The offer when in France, else null.
export function gestmaxOffer(slug: string, companyName: string, listed: Listed, html: string): CollectedOffer | null {
  const page = gestmaxPage(html);
  const field = (pattern: RegExp) => page.fields.find((item) => pattern.test(item.label))?.value ?? null;
  const country = field(/^(pays|country)\b/i);
  if (country && !isFranceCountry(country)) return null;
  const place = page.city ?? listed.place ?? field(/lieu|localisation|ville|commune|site|affectation|location/i);
  const title = page.title ?? listed.title;
  if (!title) return null;
  const contract = [listed.contract, field(/contrat|type d.emploi|statut/i)].filter(Boolean).join(" ");
  return {
    contractVersion: 1,
    source: SOURCE,
    externalId: `${slug}:${listed.id}`,
    url: listed.url,
    applyUrl: null,
    title,
    company: { name: companyName, atsSlug: slug },
    location: { raw: place, city: frenchCity(place), postcode: /\b(\d{5})\b/.exec(place ?? "")?.[1] ?? null, countryCode: "FR" },
    contractType: CONTRACTS.find(([pattern]) => pattern.test(contract))?.[1] ?? contractFrom(title),
    description: { format: "html", content: page.description || title },
    publishedAt: listed.date ? `${listed.date}T00:00:00.000Z` : null,
    collectedAt: new Date().toISOString(),
  };
}

export const gestmax: AtsAdapter = {
  ats: SOURCE,
  kind: "crawler",
  schedule: "45 6 * * *", // daily, like the career sites
  discovery: {
    prefixes: ["*.gestmax.fr"],
    slugFromUrl: (url) => (/^[a-z0-9-]+\.gestmax\.fr$/.test(url.hostname) && !/^(www|demo|maximo|simplycast)\./.test(url.hostname) ? url.hostname : null),
  },

  async check(slug) {
    const { offers } = await listOffers(slug);
    // A few pages for the share in France.
    let read = 0;
    let french = 0;
    let companyName: string | null = null;
    for (const listed of offers) {
      if (read >= collectorConfig.crawler.checkMaxPages || (read >= collectorConfig.crawler.checkSamplePages && french > 0)) break;
      try {
        read++;
        const html = (await crawlGet(listed.url)).text;
        companyName ??= clean(parse(html).querySelector('meta[property="og:site_name"]')?.getAttribute("content")) || null;
        if (gestmaxOffer(slug, "", listed, html)) french++;
      } catch (error) {
        if (!(error instanceof CrawlError)) throw error;
      }
    }
    return { companyName, jobCount: offers.length, franceJobCount: read ? Math.max(french, Math.round((offers.length * french) / read)) : 0 };
  },

  async *collect(slug, companyName, known): AsyncGenerator<CollectedRecord | StillListed | PartialListing> {
    const { offers, complete } = await listOffers(slug);
    if (!complete) yield { partialListing: true };
    let pagesRead = 0;
    let failures = 0;
    let waiting = false;
    for (const listed of offers) {
      const externalId = `${slug}:${listed.id}`;
      const unchanged = (date: string | null | undefined) => date === listed.date && !refreshDue(externalId);
      if (known?.has(externalId) && unchanged(known.get(externalId))) {
        yield { stillListed: externalId };
        continue;
      }
      if (skipped.has(externalId) && unchanged(skipped.get(externalId))) continue;
      if (pagesRead >= collectorConfig.crawler.maxOfferPagesPerRun) {
        if (known?.has(externalId)) yield { stillListed: externalId };
        else waiting = true;
        continue;
      }
      pagesRead++;
      let html: string;
      try {
        html = (await crawlGet(listed.url)).text;
        failures = 0;
      } catch (error) {
        if (!(error instanceof CrawlError)) throw error;
        if (error instanceof PageGoneError) continue;
        if (++failures >= 5) throw error;
        if (known?.has(externalId)) yield { stillListed: externalId };
        continue;
      }
      const offer = gestmaxOffer(slug, companyName, listed, html);
      if (!offer) {
        skipped.set(externalId, listed.date);
        continue;
      }
      skipped.delete(externalId);
      yield { raw: { url: listed.url, releasedDate: listed.date }, offer };
    }
    // Pages left unread may be French offers: nothing is closed this time.
    if (waiting) yield { partialListing: true };
  },
};

// Tests.
export function resetGestmaxMemory(): void {
  skipped.clear();
}
