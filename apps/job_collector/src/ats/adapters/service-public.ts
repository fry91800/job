import type { CollectedOffer, ContractType } from "@job/shared";
import { parse, type HTMLElement } from "node-html-parser";
import { collectorConfig } from "../../config";
import type { CollectedRecord } from "../../connectors/types";
import { CrawlError, crawlGet, PageGoneError } from "../../crawler/fetcher";
import { refreshDue, type AtsAdapter, type PartialListing, type StillListed } from "../adapter";
import { NotFoundError } from "../http";
import { contractFrom, frenchCity, salaryFromText } from "../mapping";

// Choisir le service public (COLLECTOR.md §17.7): the civil service's job site (State,
// territorial and hospital branches, ~55 000 offers), run by the DGAFP. Texts under the
// Etalab 2.0 open licence; robots.txt allows the offer pages. One board in the registry,
// "choisirleservicepublic.gouv.fr"; each offer names its own employer. Checked 2026-10-17:
// * the open-data file on data.gouv.fr has no description and no link, and lags ~4 weeks:
//   not used;
// * the listing /nos-offres/page/N/ shows the newest offers first, 20 per page (~190 KB
//   compressed): a run reads it until a page has only known offers (~1 000 new offers a
//   day), and once a week reads it all, so that offers taken down are closed;
// * offer pages /offre-emploi/{words}-reference-{REF}/: facts as "<span class=sr-only>
//   Label : </span> value", texts in .col-left.rte and accordions, the application deadline
//   ("Date limite de candidature") and the employer's application link.

const SOURCE = "choisirleservicepublic";
export const SERVICE_PUBLIC_BOARD = "choisirleservicepublic.gouv.fr";
const OFFER_LINK = /\/offre-emploi\/[^"'?#]*-reference-([^/"'?#]+)\/?$/i;
const MONTHS = ["janvier", "fevrier", "mars", "avril", "mai", "juin", "juillet", "aout", "septembre", "octobre", "novembre", "decembre"];

type ListedOffer = { reference: string; url: string; date: string | null };

// Offers read and skipped (unpublished, not an offer), by external id → card date: not read
// again while unchanged, and counted as known when deciding where a run stops, for as long
// as the worker runs.
const skipped = new Map<string, string | null>();

const clean = (text: string | null | undefined) => (text ?? "").replace(/\s+/g, " ").trim();
const plain = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const base = () => collectorConfig.servicePublic.baseUrl;

// "17 octobre 2026" or "17/10/2026" → ISO date.
export function frenchDate(text: string | null | undefined): string | null {
  const numeric = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(text ?? "");
  if (numeric) return new Date(Date.UTC(Number(numeric[3]), Number(numeric[2]) - 1, Number(numeric[1]))).toISOString();
  const words = /(\d{1,2})(?:er)?\s+([a-zéû]+)\s+(\d{4})/i.exec(plain(text ?? ""));
  const month = words ? MONTHS.indexOf(words[2]) : -1;
  return words && month !== -1 ? new Date(Date.UTC(Number(words[3]), month, Number(words[1]))).toISOString() : null;
}

// Offer cards of a listing page, with their "En ligne depuis le …" date.
export function listedOffers(html: string): ListedOffer[] {
  const offers: ListedOffer[] = [];
  for (const anchor of parse(html).querySelectorAll("a[href]")) {
    const href = anchor.getAttribute("href") ?? "";
    const reference = OFFER_LINK.exec(href)?.[1];
    if (!reference || offers.some((offer) => offer.reference === reference)) continue;
    const card = anchor.closest("li.item") ?? anchor.closest("li") ?? anchor.parentNode;
    const date = /en ligne depuis le ([^<\n]+?\d{4})/i.exec(card?.text ?? "")?.[1];
    offers.push({ reference: decodeURIComponent(reference), url: new URL(href, base()).toString(), date: frenchDate(date) });
  }
  return offers;
}

// "<span class="sr-only">Label : </span> value" facts, and "<strong>Label</strong> value" cells.
function facts(root: HTMLElement): Map<string, string> {
  const result = new Map<string, string>();
  for (const label of root.querySelectorAll(".sr-only")) {
    const name = clean(label.text).replace(/\s*:$/, "");
    const item = label.closest("li") ?? label.closest("p");
    if (!name || !item || result.has(name)) continue;
    // The first line: "Université de Bordeaux<br>L'université de Bordeaux" repeats the name.
    const value = clean(parse(item.innerHTML.replace(label.outerHTML, "").split(/<br\s*\/?>/i)[0]).text);
    if (value) result.set(name, value);
  }
  for (const strong of root.querySelectorAll("li strong")) {
    const name = clean(strong.text);
    const item = strong.closest("li")!;
    if (!name || result.has(name)) continue;
    const value = clean(item.querySelector(".offer-result")?.text) || clean(item.text.replace(strong.text, ""));
    if (value) result.set(name, value);
  }
  return result;
}

// The place: "Route DE BADUEL 97306 CAYENNE CEDEX", "9 boulevard du Palais 75004 Paris";
// without a postcode ("Campus Carreire - 146 rue Léo Saignat, Bordeaux"), the town is the
// last part and the département comes from the page's JSON-LD ("Gironde (33)").
export function placeFrom(text: string | null, department: string | null = null): { city: string | null; postcode: string | null; countyCode: string | null } {
  const fromDepartment = /\((2[AB]|\d{2,3})\)/.exec(department ?? "")?.[1] ?? null;
  const match = /\b(\d{5})\s+([\p{L}][\p{L}'’ -]*?)(?:\s+cedex(?:\s*\d+)?)?\s*$/iu.exec(clean(text));
  if (match) {
    const postcode = match[1];
    const countyCode = postcode.startsWith("97") ? postcode.slice(0, 3) : postcode.startsWith("20") ? fromDepartment : postcode.slice(0, 2);
    return { city: match[2].trim(), postcode, countyCode };
  }
  const last = clean(text).split(/,|\s[-–]\s/).pop()?.trim() ?? "";
  return { city: (last && frenchCity(last)) || null, postcode: null, countyCode: fromDepartment };
}

const CONTRACT_WORDS: [RegExp, ContractType][] = [
  [/\bcdi\b|contrat a duree indeterminee/, "permanent"],
  [/\bcdd\b|contrat a duree determinee/, "fixed_term"],
];

// An offer page → the offer (every offer of the site is in France).
export function servicePublicOffer(html: string, input: { url: string; reference: string }): CollectedOffer | null {
  const root = parse(html);
  const title = clean(root.querySelector("h1")?.text);
  if (!title) return null;
  const fact = facts(root);
  const text = clean(root.querySelector("main")?.text ?? root.text);

  // Description: missions and profile, then the accordions (service, additional
  // information, conditions), with the key facts first.
  const sections = [
    root.querySelector(".col-left.rte")?.innerHTML ?? "",
    ...root.querySelectorAll("section.fr-accordion").map((section) => {
      const heading = clean(section.querySelector(".fr-accordion__btn")?.text ?? section.querySelector("h3")?.text);
      const body = section.querySelector(".fr-collapse")?.innerHTML ?? "";
      return body.trim() ? `<h3>${heading}</h3>${body}` : "";
    }),
  ].filter((part) => part.trim());
  const keyFacts = ["Fonction publique", "Catégorie", "Nature de l’emploi", "Expérience souhaitée", "Management"]
    .map((name) => (fact.get(name) ? `<li><strong>${name}</strong> : ${fact.get(name)}</li>` : ""))
    .join("");
  const content = `${keyFacts ? `<ul>${keyFacts}</ul>` : ""}${sections.join("\n")}`;

  const department = /"postalCode"\s*:\s*"([^"]*)"/.exec(html)?.[1] ?? null;
  const place = placeFrom(fact.get("Localisation") ?? null, department);
  const nature = plain(`${fact.get("Nature de l’emploi") ?? ""} ${title}`);
  const remote = plain(fact.get("Télétravail possible") ?? "");
  const apply = root.querySelectorAll("a[href]").find((anchor) => /postuler/i.test(anchor.text))?.getAttribute("href") ?? null;
  const deadline = /date limite de candidature\s*:\s*(\d{2}\/\d{2}\/\d{4})/i.exec(text)?.[1];
  // In the page's JSON-LD, written "17\/10\/2026".
  const posted = /"datePosted"\s*:\s*"([^"]+)"/.exec(html)?.[1]?.replace(/\\\//g, "/");

  return {
    contractVersion: 1,
    source: SOURCE,
    externalId: `${SERVICE_PUBLIC_BOARD}:${input.reference}`,
    url: input.url,
    applyUrl: apply && /^https?:\/\//.test(apply) && !apply.startsWith(base()) ? apply : null,
    title,
    company: fact.get("Employeur") ? { name: fact.get("Employeur")! } : null,
    location: { raw: fact.get("Localisation") ?? null, ...place, countryCode: "FR" },
    remote: remote.startsWith("oui") ? "hybrid" : remote.startsWith("non") ? "onsite" : null,
    contractType: CONTRACT_WORDS.find(([pattern]) => pattern.test(nature))?.[1] ?? contractFrom(title),
    salary: salaryFromText(fact.get("Rémunération") ?? null),
    description: { format: "html", content: content.trim() || title },
    publishedAt: frenchDate(posted),
    expiresAt: frenchDate(deadline),
    collectedAt: new Date().toISOString(),
  };
}

async function listingPage(page: number): Promise<ListedOffer[]> {
  const url = page === 1 ? `${base()}/nos-offres/` : `${base()}/nos-offres/page/${page}/`;
  try {
    return listedOffers((await crawlGet(url)).text);
  } catch (error) {
    if (error instanceof PageGoneError) return [];
    throw error;
  }
}

// A full pass reads every listing page; the other runs stop at the first page whose offers
// are all known. Full: on `fullPassWeekday`, or while nothing is known yet.
function fullPassToday(known: Map<string, string | null> | undefined, now = new Date()): boolean {
  return !known?.size || now.getUTCDay() === collectorConfig.servicePublic.fullPassWeekday;
}

export const servicePublic: AtsAdapter = {
  ats: SOURCE,
  kind: "aggregator", // the employers' own sites win when the same offer is found twice
  schedule: collectorConfig.servicePublic.schedule,

  async check(slug) {
    if (slug !== SERVICE_PUBLIC_BOARD) throw new NotFoundError(`${slug}: the only board is ${SERVICE_PUBLIC_BOARD}`);
    const first = await crawlGet(`${base()}/nos-offres/`);
    const total = Number(/<span class="number">\s*([\d\s ]+)\s*<\/span>\s*offres?/i.exec(first.text)?.[1]?.replace(/\D/g, "") ?? NaN);
    const count = Number.isFinite(total) ? total : listedOffers(first.text).length;
    return { companyName: "Choisir le service public", jobCount: count, franceJobCount: count };
  },

  async *collect(_slug, _companyName, known): AsyncGenerator<CollectedRecord | StillListed | PartialListing> {
    const { maxListPages, maxOfferPagesPerRun } = collectorConfig.servicePublic;
    const full = fullPassToday(known);
    const listed = new Map<string, ListedOffer>();
    for (let page = 1; page <= maxListPages; page++) {
      const offers = await listingPage(page);
      if (offers.length === 0) break;
      offers.forEach((offer) => listed.set(offer.reference, offer));
      const seenBefore = (offer: ListedOffer) => known?.has(`${SERVICE_PUBLIC_BOARD}:${offer.reference}`) || skipped.has(`${SERVICE_PUBLIC_BOARD}:${offer.reference}`);
      if (!full && offers.every(seenBefore)) break;
    }
    if (!full) yield { partialListing: true };

    let fetched = 0;
    let failures = 0;
    for (const item of listed.values()) {
      const externalId = `${SERVICE_PUBLIC_BOARD}:${item.reference}`;
      const unchanged = (date: string | null | undefined) => date === item.date && !refreshDue(externalId);
      if (known?.has(externalId) && unchanged(known.get(externalId))) {
        yield { stillListed: externalId };
        continue;
      }
      if (skipped.has(externalId) && unchanged(skipped.get(externalId))) continue;
      // Per-run limit: known offers stay open, new ones wait for the next run.
      if (fetched >= maxOfferPagesPerRun) {
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
        if (++failures >= 5) throw error; // the site is failing: stop, nothing gets closed
        if (known?.has(externalId)) yield { stillListed: externalId };
        continue;
      }
      // Unpublished offers redirect to /offre-depubliee/.
      const offer = OFFER_LINK.test(new URL(page.url).pathname) ? servicePublicOffer(page.text, { url: page.url, reference: item.reference }) : null;
      if (!offer) {
        skipped.set(externalId, item.date);
        continue;
      }
      skipped.delete(externalId);
      const root = parse(page.text);
      const raw = { url: page.url, releasedDate: item.date, main: root.querySelector("main")?.innerHTML.slice(0, 100_000) ?? null };
      yield { raw, offer };
    }
  },
};

// Tests.
export function resetServicePublicMemory(): void {
  skipped.clear();
}
