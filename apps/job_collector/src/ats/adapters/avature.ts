import type { CollectedOffer, ContractType } from "@job/shared";
import { parse } from "node-html-parser";
import { collectorConfig } from "../../config";
import type { CollectedRecord } from "../../connectors/types";
import { parseSitemap } from "../../crawler/discover-pages";
import { CrawlError, crawlGet, PageGoneError } from "../../crawler/fetcher";
import { refreshDue, type AtsAdapter, type PartialListing, type StillListed } from "../adapter";
import { NotFoundError } from "../http";
import { contractFrom, frenchCity } from "../mapping";

// Avature career sites (COLLECTOR.md §17.17): board = host and language section,
// "jobs.totalenergies.com/fr_FR". Checked 2026-10-19 on TotalEnergies:
// * robots.txt allows /*/careers and lists a sitemap index with one sitemap per language;
// * /{lang}/careers/sitemap.xml lists every offer (/careers/JobDetail/{words}/{id}) with a
//   date (lastmod; some in the future: ignored);
// * the RSS feed has 20 offers a page and no place: not used;
// * offer pages have no JobPosting; their fields use Avature's own classes:
//   .article__content__view__field with a label ("Pays", "Ville", "Lieu de travail", "Type de
//   contrat"…, or "Country", "City"… in English) and a value; the texts are unlabelled
//   fields under <h2> headings.
// Every page is read once (French or not: the sitemap doesn't say), within the page budget
// per run; offers abroad are remembered while the worker runs.

const SOURCE = "avature";

type Listed = { id: string; url: string; date: string | null };
type Field = { label: string; value: string; html: string };

const skipped = new Map<string, string | null>();

function sectionOf(slug: string): { origin: string; lang: string } {
  const [host, lang = "en_US"] = slug.split("/");
  return { origin: `${collectorConfig.crawler.scheme}://${host}`, lang };
}

async function listOffers(slug: string): Promise<Listed[]> {
  const { origin, lang } = sectionOf(slug);
  let xml: string;
  try {
    xml = (await crawlGet(`${origin}/${lang}/careers/sitemap.xml`)).text;
  } catch (error) {
    if (error instanceof PageGoneError) throw new NotFoundError(error.message);
    throw error;
  }
  const today = new Date().toISOString().slice(0, 10);
  const offers = new Map<string, Listed>();
  for (const { loc, lastmod } of parseSitemap(xml).urls) {
    const id = /\/JobDetail\/(?:[^/?#]+\/)?(\d+)\/?(?:[?#]|$)/.exec(loc)?.[1];
    if (!id) continue;
    const date = lastmod && lastmod.slice(0, 10) <= today ? lastmod.slice(0, 10) : null;
    offers.set(id, { id, url: loc, date });
  }
  if (!offers.size && !/<urlset/i.test(xml)) throw new NotFoundError(`${slug}: no Avature sitemap`);
  return [...offers.values()];
}

export function avatureFields(html: string): { title: string | null; fields: Field[]; description: string } {
  const root = parse(html);
  const fields: Field[] = [];
  const parts: string[] = [];
  let first = true;
  for (const node of root.querySelectorAll("h2, .article__content__view__field")) {
    if (node.tagName === "H2") {
      // The first heading is the offer's title.
      if (!first) parts.push(`<h3>${node.text.trim()}</h3>`);
      first = false;
      continue;
    }
    const label = node.querySelector(".article__content__view__field__label")?.text.replace(/\s+/g, " ").trim() ?? "";
    const value = node.querySelector(".article__content__view__field__value");
    if (!value) continue;
    if (label) fields.push({ label, value: value.text.replace(/\s+/g, " ").trim(), html: value.innerHTML });
    else if (value.text.trim().length > 80) parts.push(value.innerHTML.trim());
  }
  const title = root.querySelector("h2")?.text.replace(/\s+/g, " ").trim() || root.querySelector('meta[property="og:title"]')?.getAttribute("content") || null;
  return { title, fields, description: parts.join("") };
}

const CONTRACTS: [RegExp, ContractType][] = [
  [/professionnalisation|apprentissage|alternance|apprentice/i, "apprenticeship"],
  [/ind[ée]termin|\bcdi\b|permanent/i, "permanent"],
  [/d[ée]termin|\bcdd\b|fixed/i, "fixed_term"],
  [/stage|internship|\bv\.?i\.?e\b/i, "internship"],
];

// The offer when in France, else null.
export function avatureOffer(slug: string, companyName: string, listed: Listed, html: string): CollectedOffer | null {
  const { title, fields, description } = avatureFields(html);
  const field = (pattern: RegExp) => fields.find((item) => pattern.test(item.label))?.value ?? null;
  const country = field(/^(pays|country)$/i);
  const workplace = field(/lieu|location|site/i);
  const inFrance = country ? /^france$/i.test(country) : /\bfrance\b|\(FRA\)/i.test(workplace ?? "");
  if (!inFrance || !title) return null;
  const city = field(/^(ville|city)$/i) ?? frenchCity(workplace);
  const contract = field(/contrat|contract|employment type|type d.emploi/i) ?? "";
  const nice = (text: string | null) => (text && text === text.toUpperCase() ? text.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, before: string, letter: string) => before + letter.toUpperCase()) : text);
  return {
    contractVersion: 1,
    source: SOURCE,
    externalId: `${slug}:${listed.id}`,
    url: listed.url,
    applyUrl: null,
    title,
    company: { name: companyName, atsSlug: slug },
    location: { raw: [city, workplace].filter(Boolean).join(" · ") || null, city: nice(city), postcode: /\b(\d{5})\b/.exec(workplace ?? "")?.[1] ?? null, countryCode: "FR" },
    contractType: CONTRACTS.find(([pattern]) => pattern.test(contract))?.[1] ?? contractFrom(contract, title),
    description: { format: "html", content: description || title },
    publishedAt: listed.date ? `${listed.date}T00:00:00.000Z` : null,
    collectedAt: new Date().toISOString(),
  };
}

export const avature: AtsAdapter = {
  ats: SOURCE,
  kind: "crawler",
  schedule: "30 6 * * *", // daily, like the career sites
  // Sites on avature.net are found in Common Crawl's index (their French sections only);
  // sites on the employer's domain (jobs.totalenergies.com) are added by hand.
  discovery: {
    prefixes: ["*.avature.net"],
    slugFromUrl: (url) => {
      const lang = /^\/(fr_[A-Z]{2})\//.exec(url.pathname)?.[1];
      return lang ? `${url.hostname}/${lang}` : null;
    },
  },

  async check(slug) {
    const offers = await listOffers(slug);
    // A few pages for the share in France.
    let read = 0;
    let french = 0;
    for (const listed of offers) {
      if (read >= collectorConfig.crawler.checkMaxPages || (read >= collectorConfig.crawler.checkSamplePages && french > 0)) break;
      try {
        read++;
        if (avatureOffer(slug, "", listed, (await crawlGet(listed.url)).text)) french++;
      } catch (error) {
        if (!(error instanceof CrawlError)) throw error;
      }
    }
    const host = slug.split("/")[0].split(".");
    const name = host.length > 2 ? host[host.length - 2] : host[0];
    return { companyName: name.charAt(0).toUpperCase() + name.slice(1), jobCount: offers.length, franceJobCount: read ? Math.max(french, Math.round((offers.length * french) / read)) : 0 };
  },

  async *collect(slug, companyName, known): AsyncGenerator<CollectedRecord | StillListed | PartialListing> {
    const offers = await listOffers(slug);
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
      const offer = avatureOffer(slug, companyName, listed, html);
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
export function resetAvatureMemory(): void {
  skipped.clear();
}
