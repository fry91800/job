import { matchLocation, prisma } from "@job/backend";
import type { CollectedOffer, ContractType } from "@job/shared";
import { parse, type HTMLElement } from "node-html-parser";
import { collectorConfig } from "../../config";
import type { CollectedRecord } from "../../connectors/types";
import { CrawlError, crawlGet, PageGoneError } from "../../crawler/fetcher";
import { refreshDue, type AtsAdapter, type StillListed } from "../adapter";
import { NotFoundError } from "../http";
import { stripAccents } from "../../pipeline/text";
import { contractFrom, frenchCity, mentionsFrance, nameFromSlug, remoteFrom } from "../mapping";

// Talentsoft (Cegid) career sites, {company}.talent-soft.com, often behind the employer's
// own domain (efsrecrute.fr). Large French employers (COLLECTOR.md §17.5). No API for job
// boards, and no JobPosting markup: the public pages are read, politely, by the crawler's
// fetcher (robots.txt, per-site delay). Checked 2026-10-17 on EFS, Framatome, Dassault
// Aviation, Radio France:
// * the list of every offer, 12 per page: /offre-de-emploi/liste-toutes-offres.aspx?page=N,
//   offer pages /offre-de-emploi/emploi-{words}_{id}.aspx;
// * offer pages: fields as "<h3>Label</h3><p id="fld…">value</p>" (labels vary by employer),
//   the location as "France, Région, Département (71)"; some employers use free-form pages
//   instead. Every page has a meta description "Offre d'emploi … de 'Title'. Lieu : X.
//   Date : dd/mm/yyyy. Ref : …" and its content in .ts-offer-page__content-details.
// The RSS feed (/handlers/offerRss.ashx) only lists the 20 newest offers: not used.

const SOURCE = "talentsoft";
const LIST_PATH = "/offre-de-emploi/liste-toutes-offres.aspx";
const OFFER_LINK = /\/offre-de-emploi\/emploi-[^"'?#]*?_(\d+)\.aspx/i;

type ListedOffer = { id: string; url: string; date: string | null };

// Offers read and skipped (not in France), by external id → card date: not read again
// while unchanged, for as long as the worker runs.
const skipped = new Map<string, string | null>();
type Field = { id: string; label: string; text: string; html: string };

const clean = (text: string) => text.replace(/\s+/g, " ").trim();
const startUrl = (slug: string) => `${collectorConfig.crawler.scheme}://${slug}${LIST_PATH}?all=1&mode=list&LCID=1036`;
const frenchDate = (text: string | null | undefined) => {
  const match = /(\d{2})\/(\d{2})\/(\d{4})/.exec(text ?? "");
  return match ? new Date(Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1]))).toISOString() : null;
};

// The site's offers, page after page (`maxPages`: all by default), from the address the
// site redirects to.
async function listOffers(slug: string, maxPages = collectorConfig.crawler.talentsoftMaxListPages): Promise<{ origin: string; offers: ListedOffer[]; total: number | null }> {
  let first: { url: string; text: string };
  try {
    first = await crawlGet(startUrl(slug));
  } catch (error) {
    if (error instanceof PageGoneError) throw new NotFoundError(error.message);
    throw error;
  }
  if (!first.text.includes("offre-de-emploi")) throw new NotFoundError(`${slug}: not a Talentsoft career site`);
  const origin = new URL(first.url).origin;
  const total = Number(/\((\d+)\s+offres?\b/i.exec(first.text)?.[1] ?? NaN);
  const offers = new Map<string, ListedOffer>();
  let html = first.text;
  for (let page = 1; page <= maxPages; page++) {
    const before = offers.size;
    for (const item of listedOffers(html, origin)) if (!offers.has(item.id)) offers.set(item.id, item);
    if (page === maxPages || offers.size === before || (Number.isFinite(total) && offers.size >= total)) break;
    try {
      html = (await crawlGet(`${origin}${LIST_PATH}?page=${page + 1}&LCID=1036`)).text;
    } catch (error) {
      if (error instanceof PageGoneError) break;
      throw error;
    }
  }
  return { origin, offers: [...offers.values()], total: Number.isFinite(total) ? total : null };
}

// Offer links of a list page, with the date shown on the offer's card when there is one.
export function listedOffers(html: string, origin: string): ListedOffer[] {
  const offers: ListedOffer[] = [];
  for (const anchor of parse(html).querySelectorAll("a[href]")) {
    const href = anchor.getAttribute("href") ?? "";
    const id = OFFER_LINK.exec(href)?.[1];
    if (!id || offers.some((offer) => offer.id === id)) continue;
    const card = anchor.closest("li") ?? anchor.parentNode;
    offers.push({ id, url: new URL(href, origin).toString(), date: frenchDate(card?.text) });
  }
  return offers;
}

// "<h3>Label</h3><p id="fld…">value</p>" pairs of an offer page.
function fields(root: HTMLElement): Field[] {
  return root.querySelectorAll("[id^=fld]").map((element) => {
    let previous = element.previousElementSibling;
    while (previous && previous.tagName !== "H3") previous = previous.previousElementSibling;
    return { id: element.id.toLowerCase(), label: clean(previous?.text ?? ""), text: clean(element.text), html: element.innerHTML };
  });
}

const CONTRACT_WORDS: [RegExp, ContractType][] = [
  [/ind[ée]termin/i, "permanent"],
  [/d[ée]termin/i, "fixed_term"],
];

// The place, and whether it is in France. The location field reads "France, Région,
// Département (71)", sometimes after the continent ("Europe, France, …"), and employers
// working only in France often leave the country out ("Ile-de-France, Paris (75)",
// "Occitanie"). In France: France (or an overseas département) named, a French région, a
// département "(44)", a known French city or a 5-digit postcode. Abroad: the field starts
// with another country. Otherwise unknown (`france: null`): the town is looked up
// (placeCountry), since sites of other countries (Belgium…) use the same pages.
type Place = { france: boolean | null; city: string | null; postcode: string | null; countyCode: string | null };

const FRANCE = /^(france|la reunion|reunion|guadeloupe|martinique|guyane|mayotte)$/;
const FRENCH_REGIONS = new RegExp(
  `\\b(${[
    "ile-de-france", "auvergne-rhone-alpes", "bourgogne-franche-comte", "bretagne", "centre-val de loire", "corse", "grand est",
    "hauts-de-france", "normandie", "nouvelle-aquitaine", "occitanie", "pays de la loire", "provence-alpes-cote d'azur", "paca",
    "nord-pas de calais", "picardie", "aquitaine", "limousin", "poitou-charentes", "midi-pyrenees", "languedoc-roussillon",
    "rhone-alpes", "auvergne", "bourgogne", "franche-comte", "alsace", "lorraine", "champagne-ardenne", "haute-normandie", "basse-normandie",
  ].map((name) => name.replace(/[-\s]/g, "[-\\s]")).join("|")})\\b`,
);
const FOREIGN = /^(belgique|belgium|suisse|switzerland|schweiz|luxembourg|allemagne|germany|deutschland|autriche|austria|osterreich|royaume-uni|united kingdom|uk|irlande|ireland|espagne|spain|italie|italy|portugal|pays-bas|netherlands|danemark|denmark|suede|sweden|norvege|norway|finlande|finland|pologne|poland|maroc|morocco|tunisie|tunisia|algerie|algeria|canada|etats-unis|united states|usa)$/;

export function talentsoftPlace(area: string | null, place: string | null): Place {
  const plain = (text: string) => stripAccents(text).toLowerCase().trim();
  const county = /\((2[AB]|\d{2,3})\)/.exec(`${area ?? ""} ${place ?? ""}`)?.[1] ?? null;
  const postcode = /\b\d{5}\b/.exec(place ?? "")?.[0] ?? null;
  const parts = (area ?? "").split(",").map((part) => part.trim()).filter(Boolean);
  // The town: the place text, else the field's last part ("Bagneux" alone too) when it is
  // neither a département "(92)", a région nor a country.
  const lastPart = parts[parts.length - 1] ?? "";
  const last = lastPart && !/\(\w+\)/.test(lastPart) && !FRENCH_REGIONS.test(plain(lastPart)) && !FRANCE.test(plain(lastPart)) && !FOREIGN.test(plain(lastPart)) ? lastPart : null;
  const city = (place && frenchCity(place.replace(/\(\w+\)/g, "").replace(/\b\d{5}\b/g, ""))) || (last && frenchCity(last)) || null;
  if (parts.some((part) => FRANCE.test(plain(part)))) return { france: true, city, postcode, countyCode: county };
  if (parts.length && FOREIGN.test(plain(parts[0]))) return { france: false, city: null, postcode: null, countyCode: null };
  const text = [area, place].filter(Boolean).join(", ");
  if (county !== null || postcode !== null || mentionsFrance(text) || FRENCH_REGIONS.test(plain(text))) return { france: true, city, postcode, countyCode: county };
  return { france: city ? null : false, city, postcode: null, countyCode: null };
}

// Country of a place name, from the locations table, else Geoapify (the place is stored:
// each town is looked up once).
export async function placeCountry(city: string): Promise<string | null> {
  const id = await matchLocation(prisma, { city, region: null, countryCode: null });
  return id === null ? null : ((await prisma.location.findUnique({ where: { id }, select: { countryCode: true } }))?.countryCode ?? null);
}

// Numbers of a pay text ("45 000 - 55 000 € brut annuel", "2 100 € par mois").
function salaryFrom(raw: string | null): CollectedOffer["salary"] {
  if (!raw) return null;
  const amounts = [...raw.replace(/(\d)[\s .](?=\d{3}\b)/g, "$1").matchAll(/\d+(?:,\d+)?\s*(k)?/gi)]
    .map((match) => Number(match[0].replace(/[^\d,]/g, "").replace(",", ".")) * (match[1] ? 1000 : 1))
    .filter((value) => value >= 100);
  if (amounts.length === 0) return null;
  const monthly = /mois|mensuel/i.test(raw) || Math.max(...amounts) < 10000;
  return { min: Math.min(...amounts), max: Math.max(...amounts), currency: "EUR", period: monthly ? "month" : "year", raw: raw.slice(0, 300) };
}

// An offer page → the offer, or null when it isn't in France (or isn't an offer).
export async function talentsoftOffer(
  html: string,
  input: { url: string; id: string; slug: string; companyName: string },
  lookUp: (city: string) => Promise<string | null> = placeCountry,
): Promise<CollectedOffer | null> {
  const root = parse(html);
  const meta = clean(root.querySelector("meta[name=Description]")?.getAttribute("content") ?? "");
  const all = fields(root);
  const byId = (pattern: RegExp) => all.find((field) => pattern.test(field.id));
  const byLabel = (pattern: RegExp) => all.find((field) => pattern.test(field.label));

  const title = byId(/_jobtitle$/)?.text || clean(root.querySelector("h1")?.text ?? "") || /de '(.+?)'\. Lieu/.exec(meta)?.[1] || "";
  if (!title) return null;
  const area = byId(/geographicalareacollection$/)?.text ?? null;
  // The place: "Lieu", "Lieu de travail", "Site", "Ville", "Secteur et lieu", "Localisation du
  // poste à pourvoir"… (not the location field itself), else the meta description.
  const placeField = all.find((field) => !/geographicalareacollection$/.test(field.id) && field.text && /^(lieu|ville|site|secteur|localisation)\b/i.test(field.label));
  const placeText = placeField?.text || clean(/Lieu : (.*?)\. Date/.exec(meta)?.[1] ?? "") || null;
  const place = talentsoftPlace(area, placeText);
  if (place.france === null && place.city) place.france = (await lookUp(place.city)) === "FR";
  if (!place.france) return null;

  // Description: the rich-text sections with their headings, the job's own first (mission,
  // profile), the employer's general texts (diversity policy…) after; free-form pages: the
  // content block.
  const group = (field: Field) => (field.id.startsWith("fldjobdescription_") ? 0 : field.id.startsWith("fldapplicantcriteria_") ? 1 : 2);
  const sections = all
    .filter((field) => /description\d*$|longtext\d*$/.test(field.id) && field.text.length > 0)
    .map((field, index) => ({ field, index }))
    .sort((a, b) => group(a.field) - group(b.field) || a.index - b.index)
    .map(({ field }) => field);
  const content = sections.length
    ? sections.map((field) => `${field.label ? `<h3>${field.label}</h3>` : ""}${field.html}`).join("\n")
    : (root.querySelector(".ts-offer-page__content-details")?.innerHTML ?? "");
  const contract = byId(/_contract$/)?.text ?? null;
  const pay = all.filter((field) => /r[ée]mun[ée]ration|salaire/i.test(field.label) || /_salaryrange$/.test(field.id)).map((field) => field.text);

  return {
    contractVersion: 1,
    source: SOURCE,
    externalId: `${input.slug}:${input.id}`,
    url: input.url,
    applyUrl: null,
    title,
    company: { name: input.companyName, atsSlug: input.slug },
    location: { raw: area ?? placeText, city: place.city, postcode: place.postcode, countyCode: place.countyCode, countryCode: "FR" },
    remote: remoteFrom(title, byLabel(/t[ée]l[ée]travail/i)?.text),
    contractType: CONTRACT_WORDS.find(([pattern]) => pattern.test(contract ?? ""))?.[1] ?? contractFrom(contract, title),
    salary: salaryFrom(pay.join(" - ") || null),
    description: { format: "html", content: content.trim() || title },
    publishedAt: frenchDate(root.querySelector(".ts-offer-page__maj-date")?.text) ?? frenchDate(/Date : ([\d/]+)/.exec(meta)?.[1]),
    expiresAt: frenchDate(byLabel(/date limite/i)?.text),
    collectedAt: new Date().toISOString(),
  };
}

// "framatome-career.talent-soft.com" → "Framatome"; the company name isn't on the pages.
export function companyFromSlug(slug: string): string {
  const sub = slug.split(".")[0].replace(/^(recrutement|recrute|careers?|emploi|jobs?)-/, "").replace(/-(careers?|cand|candidats?|recrute|recrutement|emploi|jobs?|rh)$/, "");
  return nameFromSlug(sub);
}

const NOT_SITES = new Set(["www", "app", "api", "help", "support", "blog", "status", "demo", "cegid"]);

export const talentsoft: AtsAdapter = {
  ats: SOURCE,
  kind: "crawler",
  schedule: "0 4 * * *", // daily, like the career sites
  discovery: {
    prefixes: ["*.talent-soft.com"],
    slugFromUrl: (url) => {
      const host = url.hostname.toLowerCase();
      if (!host.endsWith(".talent-soft.com")) return null;
      const sub = host.slice(0, -".talent-soft.com".length);
      return /^[a-z0-9][a-z0-9-]{0,62}$/.test(sub) && !NOT_SITES.has(sub) ? host : null;
    },
  },

  async check(slug) {
    // The first list page gives the total and enough offers to sample.
    const { offers, total } = await listOffers(slug, 1);
    const sample = offers.slice(0, collectorConfig.crawler.checkSamplePages);
    let french = 0;
    let read = 0;
    for (const item of sample) {
      try {
        const offer = await talentsoftOffer((await crawlGet(item.url)).text, { url: item.url, id: item.id, slug, companyName: "" });
        read++;
        if (offer) french++;
      } catch (error) {
        if (!(error instanceof CrawlError)) throw error;
      }
    }
    const jobCount = total ?? offers.length;
    return { companyName: companyFromSlug(slug), jobCount, franceJobCount: read ? Math.round((jobCount * french) / read) : 0 };
  },

  async *collect(slug, companyName, known): AsyncGenerator<CollectedRecord | StillListed> {
    const { offers } = await listOffers(slug);
    let fetched = 0;
    let failures = 0;
    for (const item of offers) {
      const externalId = `${slug}:${item.id}`;
      // Known and unchanged (same date on its card, no weekly refresh due): still listed.
      const unchanged = (date: string | null | undefined) => date === item.date && !refreshDue(externalId);
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
        page = await crawlGet(item.url);
        failures = 0;
      } catch (error) {
        if (!(error instanceof CrawlError)) throw error;
        if (error instanceof PageGoneError) continue;
        // Several failures in a row: the site is failing, stop (nothing gets closed).
        if (++failures >= 5) throw error;
        if (known?.has(externalId)) yield { stillListed: externalId };
        continue;
      }
      const offer = await talentsoftOffer(page.text, { url: page.url, id: item.id, slug, companyName });
      if (!offer) {
        skipped.set(externalId, item.date);
        continue;
      }
      skipped.delete(externalId);
      // Kept raw: the offer's part of the page, not the whole page (menus, scripts).
      const root = parse(page.text);
      const raw = {
        url: page.url,
        releasedDate: item.date,
        meta: root.querySelector("meta[name=Description]")?.getAttribute("content") ?? null,
        content: root.querySelector(".ts-offer-page__content-details")?.outerHTML.slice(0, 100_000) ?? null,
      };
      yield { raw, offer };
    }
  },
};

// Tests.
export function resetTalentsoftMemory(): void {
  skipped.clear();
}
