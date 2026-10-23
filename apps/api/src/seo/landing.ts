import { Prisma, type ContractType } from "@prisma/client";
import { escapeHtml } from "@job/shared/src/markdown";
import { config } from "../config";
import { prisma } from "../lib/prisma";
import { appTemplate } from "./offer-page";

// Landing pages for the searches people type (SEO.md): a job, a place, a job in a place,
// for all offers (/emplois), apprenticeships (/alternance) and internships (/stage). Places
// are towns (/a/{ville-NN}), départements (/departement/{nom-NN}) and regions
// (/region/{nom}). Jobs are the ROME occupations (French names). A page exists only with
// enough open public offers (config.seo.landing), so search engines get no thin pages. Plain
// server pages with the app's stylesheet: no app on top (its address handling would leave
// them), links to offer pages and to the app's search.

// --- Scopes: which offers a family of pages lists -----------------------------------------

export type Scope = { key: string; prefix: string; contract: ContractType | null; noun: string; nounWithJob: string; countOne: string; countMany: string; hubTitle: string };

export const SCOPES: Scope[] = [
  { key: "emplois", prefix: "/emplois", contract: null, noun: "Offres d'emploi", nounWithJob: "Offres d'emploi", countOne: "offre", countMany: "offres", hubTitle: "Offres d'emploi par métier et par lieu" },
  { key: "alternance", prefix: "/alternance", contract: "apprenticeship", noun: "Offres en alternance", nounWithJob: "Alternance", countOne: "offre en alternance", countMany: "offres en alternance", hubTitle: "Offres en alternance par métier et par lieu" },
  { key: "stage", prefix: "/stage", contract: "internship", noun: "Offres de stage", nounWithJob: "Stage", countOne: "offre de stage", countMany: "offres de stage", hubTitle: "Offres de stage par métier et par lieu" },
];

// --- The index: counts of open public offers by job, place and job in place ---------------

type Occupation = { id: number; slug: string; name: string; total: number };
export type PlaceKind = "city" | "county" | "region";
type Place = { kind: PlaceKind; key: string; slug: string; name: string; label: string; total: number; countyKey: string | null; regionKey: string | null; locationId?: number; countyCode?: string; regionName?: string };
type Index = { at: number; occupations: Map<string, Occupation>; byOccupationId: Map<number, Occupation>; places: Map<string, Place>; bySlug: Map<string, Place>; pairs: Map<string, number> };

const REFRESH_MS = 3600 * 1000;
const cached = new Map<string, Index>();
const loading = new Map<string, Promise<Index>>();

export function slugify(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
}

const pairKey = (occupationId: number, placeKey: string) => `${occupationId}|${placeKey}`;
const slugKey = (kind: PlaceKind, slug: string) => `${kind}:${slug}`;

async function buildIndex(scope: Scope): Promise<Index> {
  const { minOccupation } = config.seo.landing;
  const contract = scope.contract ? Prisma.sql`AND o.contract_type = ${scope.contract}::contract_type` : Prisma.empty;
  const [pairRows, placeRows] = await Promise.all([
    prisma.$queryRaw<{ occupation_id: number; location_id: number | null; count: bigint }[]>`
      SELECT oo.occupation_id, o.location_id, count(*) AS count
      FROM offers o
      JOIN offer_occupations oo ON oo.offer_id = o.id
      JOIN occupations occ ON occ.id = oo.occupation_id AND occ.source = 'rome'
      WHERE o.is_public AND o.closed_at IS NULL ${contract}
      GROUP BY 1, 2`,
    prisma.$queryRaw<{ location_id: number; count: bigint }[]>`
      SELECT o.location_id, count(*) AS count
      FROM offers o JOIN locations l ON l.id = o.location_id AND l.type = 'city' AND l.country_code = 'FR'
      WHERE o.is_public AND o.closed_at IS NULL ${contract}
      GROUP BY 1`,
  ]);

  // Jobs.
  const occupationTotals = new Map<number, number>();
  for (const row of pairRows) occupationTotals.set(row.occupation_id, (occupationTotals.get(row.occupation_id) ?? 0) + Number(row.count));
  const occupationIds = [...occupationTotals].filter(([, total]) => total >= minOccupation).map(([id]) => id);
  const names = await prisma.occupationName.findMany({ where: { occupationId: { in: occupationIds }, isCanonical: true, language: "fr" }, select: { occupationId: true, name: true } });
  const occupations = new Map<string, Occupation>();
  const byOccupationId = new Map<number, Occupation>();
  for (const { occupationId, name } of names) {
    const slug = slugify(name);
    if (!slug || occupations.has(slug)) continue;
    const occupation = { id: occupationId, slug, name, total: occupationTotals.get(occupationId) ?? 0 };
    occupations.set(slug, occupation);
    byOccupationId.set(occupationId, occupation);
  }

  // Places: each town, its département and its region.
  const locations = await prisma.location.findMany({
    where: { id: { in: placeRows.map((row) => row.location_id) } },
    select: { id: true, name: true, countyCode: true, countyName: true, regionName: true },
  });
  const places = new Map<string, Place>();
  const bySlug = new Map<string, Place>();
  const placesOf = new Map<number, Place[]>();
  const add = (place: Omit<Place, "total">): Place | null => {
    const existing = places.get(place.key);
    if (existing) return existing;
    if (!place.slug || bySlug.has(slugKey(place.kind, place.slug))) return null;
    const created = { ...place, total: 0 };
    places.set(place.key, created);
    bySlug.set(slugKey(place.kind, place.slug), created);
    return created;
  };
  for (const location of locations) {
    const region = location.regionName ? add({ kind: "region", key: `r:${slugify(location.regionName)}`, slug: slugify(location.regionName), name: location.regionName, label: location.regionName, countyKey: null, regionKey: null, regionName: location.regionName }) : null;
    const county =
      location.countyCode && location.countyName
        ? add({ kind: "county", key: `d:${location.countyCode}`, slug: slugify(`${location.countyName}-${location.countyCode}`), name: location.countyName, label: `${location.countyName} (${location.countyCode})`, countyKey: null, regionKey: region?.key ?? null, countyCode: location.countyCode })
        : null;
    const city = add({ kind: "city", key: `c:${location.id}`, slug: slugify(`${location.name}${location.countyCode ? `-${location.countyCode}` : ""}`), name: location.name, label: location.countyCode ? `${location.name} (${location.countyCode})` : location.name, countyKey: county?.key ?? null, regionKey: region?.key ?? null, locationId: location.id });
    placesOf.set(location.id, [city, county, region].filter((place): place is Place => !!place));
  }
  for (const row of placeRows) for (const place of placesOf.get(row.location_id) ?? []) place.total += Number(row.count);

  const pairs = new Map<string, number>();
  for (const row of pairRows) {
    if (row.location_id === null || !byOccupationId.has(row.occupation_id)) continue;
    for (const place of placesOf.get(row.location_id) ?? []) {
      const key = pairKey(row.occupation_id, place.key);
      pairs.set(key, (pairs.get(key) ?? 0) + Number(row.count));
    }
  }
  return { at: Date.now(), occupations, byOccupationId, places, bySlug, pairs };
}

export async function landingIndex(scope: Scope): Promise<Index> {
  const current = cached.get(scope.key);
  if (current && Date.now() - current.at < REFRESH_MS) return current;
  if (!loading.has(scope.key)) {
    loading.set(
      scope.key,
      buildIndex(scope).finally(() => loading.delete(scope.key)),
    );
  }
  const index = await loading.get(scope.key)!;
  cached.set(scope.key, index);
  return index;
}

// Tests.
export function resetLandingIndex(): void {
  cached.clear();
}

// --- Addresses ------------------------------------------------------------------------------

const PLACE_SEGMENT: Record<PlaceKind, string> = { city: "a", county: "departement", region: "region" };
const placePath = (scope: Scope, place: Place) => `${scope.prefix}/${PLACE_SEGMENT[place.kind]}/${place.slug}`;
const occupationPath = (scope: Scope, occupation: Occupation) => `${scope.prefix}/${occupation.slug}`;
const pairPath = (scope: Scope, occupation: Occupation, place: Place) =>
  place.kind === "city" ? `${scope.prefix}/${occupation.slug}/${place.slug}` : `${scope.prefix}/${occupation.slug}/${PLACE_SEGMENT[place.kind]}/${place.slug}`;

const placeShown = (place: Place) => place.total >= config.seo.landing.minCity;
const pairShown = (count: number | undefined) => (count ?? 0) >= config.seo.landing.minPair;

// Every landing page worth indexing, for the sitemaps.
export async function landingPaths(): Promise<string[]> {
  const paths: string[] = [];
  for (const scope of SCOPES) {
    const index = await landingIndex(scope);
    if (!index.occupations.size && ![...index.places.values()].some(placeShown)) continue;
    paths.push(scope.prefix);
    for (const occupation of index.occupations.values()) paths.push(occupationPath(scope, occupation));
    for (const place of index.places.values()) if (placeShown(place)) paths.push(placePath(scope, place));
    for (const [key, count] of index.pairs) {
      if (!pairShown(count)) continue;
      const [occupationId, placeKey] = key.split("|");
      const occupation = index.byOccupationId.get(Number(occupationId));
      const place = index.places.get(placeKey);
      if (occupation && place) paths.push(pairPath(scope, occupation, place));
    }
  }
  return paths;
}

// --- Pages -------------------------------------------------------------------------------

type ListedOffer = { id: string; title: string; companyName: string | null; contractType: string | null; publishedAt: Date | null; createdAt: Date; location: { name: string; countyCode: string | null } | null };

const CONTRACTS: Record<string, string> = { permanent: "CDI", fixed_term: "CDD", temporary: "Intérim", freelance: "Freelance", internship: "Stage", apprenticeship: "Alternance", other: "Autre contrat" };
const shortDate = (date: Date) => new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", timeZone: "Europe/Paris" }).format(date);
const number = (count: number) => new Intl.NumberFormat("fr-FR").format(count);
const counted = (scope: Scope, count: number, suffix = "") => `${number(count)} ${count > 1 ? scope.countMany : scope.countOne}${suffix}`;

// "à Lyon", "en Bretagne", "dans le Grand Est", "– Rhône (69)".
const REGION_PHRASES: Record<string, string> = {
  "Grand Est": "dans le Grand Est",
  "Hauts-de-France": "dans les Hauts-de-France",
  "Pays de la Loire": "dans les Pays de la Loire",
  "La Réunion": "à La Réunion",
  Mayotte: "à Mayotte",
};
export function placePhrase(place: Pick<Place, "kind" | "name" | "label">): string {
  if (place.kind === "city") return `à ${place.name}`;
  if (place.kind === "region") return REGION_PHRASES[place.name] ?? `en ${place.name}`;
  return `– ${place.label}`;
}

const heading = (scope: Scope, occupation?: Occupation, place?: Place) =>
  [occupation ? `${scope.nounWithJob} ${occupation.name}` : scope.noun, place && placePhrase(place)].filter(Boolean).join(" ");

async function newestOffers(scope: Scope, filter: { occupationId?: number; place?: Place }): Promise<ListedOffer[]> {
  const place = filter.place;
  return prisma.offer.findMany({
    where: {
      isPublic: true,
      closedAt: null,
      ...(scope.contract && { contractType: scope.contract }),
      ...(filter.occupationId !== undefined && { occupations: { some: { occupationId: filter.occupationId } } }),
      ...(place?.kind === "city" && { locationId: place.locationId }),
      ...(place?.kind === "county" && { location: { countryCode: "FR", countyCode: place.countyCode } }),
      ...(place?.kind === "region" && { location: { countryCode: "FR", regionName: place.regionName } }),
    },
    select: { id: true, title: true, companyName: true, contractType: true, publishedAt: true, createdAt: true, location: { select: { name: true, countyCode: true } } },
    orderBy: [{ publishedAt: { sort: "desc", nulls: "last" } }, { id: "asc" }],
    take: config.seo.landing.offersShown,
  });
}

function offerList(offers: ListedOffer[]): string {
  return `<ul class="landing-offers">${offers
    .map((offer) => {
      const facts = [offer.companyName, offer.location && (offer.location.countyCode ? `${offer.location.name} (${offer.location.countyCode})` : offer.location.name), offer.contractType && CONTRACTS[offer.contractType], shortDate(offer.publishedAt ?? offer.createdAt)].filter(Boolean) as string[];
      return `<li><a href="/offers/${offer.id}">${escapeHtml(offer.title)}</a><br><span>${facts.map(escapeHtml).join(" · ")}</span></li>`;
    })
    .join("")}</ul>`;
}

const linkList = (title: string, links: { href: string; label: string }[]) =>
  links.length ? `<h2>${escapeHtml(title)}</h2><ul class="landing-links">${links.map((link) => `<li><a href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a></li>`).join("")}</ul>` : "";

// The app's search with the job, the town (towns only: the app searches around a place) and
// the scope's contract filled in.
const searchLink = (scope: Scope, q: string, place?: Place) => {
  const params = new URLSearchParams({ ...(q && { q }), ...(place?.kind === "city" && { locationId: String(place.locationId), location: place.name }), ...(scope.contract && { contractType: scope.contract }) });
  return `/?${params}`;
};

// Audience measurement (Umami, GROWTH.md), with the same settings as in the app
// (apps/web/src/lib/analytics.ts): these pages don't load the app.
function analyticsTag(): string {
  const id = config.analytics.umamiWebsiteId;
  if (!id) return "";
  return `<script defer src="/u/script.js" data-website-id="${escapeHtml(id)}" data-domains="${escapeHtml(new URL(config.webBaseUrl).hostname)}" data-exclude-search="true" data-do-not-track="true"></script>`;
}

// The page around the content: the app's stylesheet and theme, a header, links at the end.
function document(input: { title: string; description: string; path: string; body: string; noindex?: boolean }): string {
  const template = appTemplate() ?? "";
  const styles = [...template.matchAll(/<link rel="stylesheet"[^>]*>/g)].map((match) => match[0]).join("\n    ");
  const canonical = `${config.webBaseUrl}${input.path}`;
  return `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="light dark" />
    <title>${escapeHtml(input.title)} | ${escapeHtml(config.seo.siteName)}</title>
    <meta name="description" content="${escapeHtml(input.description)}" />
    <link rel="canonical" href="${escapeHtml(canonical)}" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="${escapeHtml(config.seo.siteName)}" />
    <meta property="og:title" content="${escapeHtml(input.title)}" />
    <meta property="og:description" content="${escapeHtml(input.description)}" />
    <meta property="og:url" content="${escapeHtml(canonical)}" />
    ${input.noindex ? `<meta name="robots" content="noindex" />` : ""}
    <script src="/theme-init.js"></script>
    ${analyticsTag()}
    ${styles}
  </head>
  <body>
    <main class="landing">
      <p class="landing-top"><a href="/"><img src="/favicon.svg" alt="" width="20" height="20" /> ${escapeHtml(config.seo.siteName)}</a> · <a href="/emplois">Emploi</a> · <a href="/alternance">Alternance</a> · <a href="/stage">Stage</a></p>
      ${input.body}
      <p class="landing-foot"><a href="/emplois">Offres d'emploi</a> · <a href="/alternance">Alternance</a> · <a href="/stage">Stages</a> · <a href="/privacy">Confidentialité</a> · <a href="/terms">Conditions d'utilisation</a></p>
    </main>
  </body>
</html>`;
}

export type LandingPage = { status: number; html: string };

const notFound = (scope: Scope): LandingPage => ({
  status: 404,
  html: document({ title: "Page introuvable", description: "Cette page n'existe pas ou plus.", path: scope.prefix, noindex: true, body: `<h1>Page introuvable</h1><p>Il n'y a pas (ou plus) assez d'offres pour cette recherche. <a href="${scope.prefix}">Voir les ${escapeHtml(scope.noun.toLowerCase())} par métier et par lieu</a>.</p>` }),
});

const description = (scope: Scope, count: number, what: string) => `${counted(scope, count)} ${what}, mises à jour chaque jour. Postulez avec un CV adapté à chaque offre.`;

// The places of one kind, by count, as links (to the place, or to the job in the place).
function placeLinks(scope: Scope, index: Index, kind: PlaceKind, options: { occupation?: Occupation; within?: Place; except?: Place; limit?: number } = {}) {
  const { occupation, within, except } = options;
  return [...index.places.values()]
    .filter((place) => place.kind === kind && place !== except && (!within || place.countyKey === within.key || place.regionKey === within.key))
    .map((place) => ({ place, count: occupation ? (index.pairs.get(pairKey(occupation.id, place.key)) ?? 0) : place.total }))
    .filter(({ place, count }) => (occupation ? pairShown(count) : placeShown(place)))
    .sort((a, b) => b.count - a.count || a.place.name.localeCompare(b.place.name, "fr"))
    .slice(0, options.limit ?? config.seo.landing.linksShown)
    .map(({ place, count }) => ({ href: occupation ? pairPath(scope, occupation, place) : placePath(scope, place), label: `${place.label} (${number(count)})` }));
}

// The jobs of a place (or of France), by count, as links.
function occupationLinks(scope: Scope, index: Index, place?: Place, except?: Occupation, limit = config.seo.landing.linksShown) {
  return [...index.occupations.values()]
    .filter((occupation) => occupation !== except)
    .map((occupation) => ({ occupation, count: place ? (index.pairs.get(pairKey(occupation.id, place.key)) ?? 0) : occupation.total }))
    .filter(({ count }) => (place ? pairShown(count) : count > 0))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map(({ occupation, count }) => ({ href: place ? pairPath(scope, occupation, place) : occupationPath(scope, occupation), label: `${occupation.name} (${number(count)})` }));
}

// The same page in the other scopes, when it exists there ("Alternance Développeur à Lyon").
async function otherScopes(scope: Scope, occupationSlug?: string, placeSlug?: { kind: PlaceKind; slug: string }) {
  const links: { href: string; label: string }[] = [];
  for (const other of SCOPES) {
    if (other === scope) continue;
    const index = await landingIndex(other);
    const occupation = occupationSlug ? index.occupations.get(occupationSlug) : undefined;
    const place = placeSlug ? index.bySlug.get(slugKey(placeSlug.kind, placeSlug.slug)) : undefined;
    if ((occupationSlug && !occupation) || (placeSlug && !place)) continue;
    const count = occupation && place ? index.pairs.get(pairKey(occupation.id, place.key)) : occupation ? occupation.total : place ? place.total : undefined;
    if (occupation && place ? !pairShown(count) : place ? !placeShown(place) : !count && occupationSlug) continue;
    const href = occupation && place ? pairPath(other, occupation, place) : occupation ? occupationPath(other, occupation) : place ? placePath(other, place) : other.prefix;
    links.push({ href, label: `${heading(other, occupation, place)}${count ? ` (${number(count)})` : ""}` });
  }
  return links;
}

export async function hubPage(scope: Scope): Promise<LandingPage> {
  const index = await landingIndex(scope);
  const { linksShown } = config.seo.landing;
  const body = `<h1>${escapeHtml(scope.hubTitle)}</h1>
<p>Les offres publiées par les employeurs, réunies sur ${escapeHtml(config.seo.siteName)} : choisissez un métier ou un lieu, puis adaptez votre CV à chaque offre.</p>
${linkList("Métiers", occupationLinks(scope, index, undefined, undefined, linksShown * 3))}
${linkList("Régions", placeLinks(scope, index, "region", { limit: 30 }))}
${linkList("Départements", placeLinks(scope, index, "county", { limit: linksShown * 2 }))}
${linkList("Villes", placeLinks(scope, index, "city", { limit: linksShown * 3 }))}
${linkList("Voir aussi", await otherScopes(scope))}`;
  return { status: 200, html: document({ title: scope.hubTitle, description: `${scope.noun} par métier, ville, département et région, mises à jour chaque jour. Postulez avec un CV adapté à chaque offre.`, path: scope.prefix, body }) };
}

export async function occupationPage(scope: Scope, occupationSlug: string): Promise<LandingPage> {
  const index = await landingIndex(scope);
  const occupation = index.occupations.get(occupationSlug);
  if (!occupation) return notFound(scope);
  const offers = await newestOffers(scope, { occupationId: occupation.id });
  const title = heading(scope, occupation);
  const body = `<h1>${escapeHtml(title)}</h1>
<p>${counted(scope, occupation.total, " en cours")} en France. Les plus récentes :</p>
${offerList(offers)}
<p><a href="${escapeHtml(searchLink(scope, occupation.name))}">Rechercher et filtrer toutes les offres ${escapeHtml(occupation.name)}</a></p>
${linkList(`${occupation.name} par région`, placeLinks(scope, index, "region", { occupation, limit: 30 }))}
${linkList(`${occupation.name} par département`, placeLinks(scope, index, "county", { occupation }))}
${linkList(`${occupation.name} par ville`, placeLinks(scope, index, "city", { occupation }))}
${linkList("Voir aussi", await otherScopes(scope, occupation.slug))}`;
  return { status: 200, html: document({ title, description: description(scope, occupation.total, `${occupation.name} en France`), path: occupationPath(scope, occupation), body }) };
}

export async function placePage(scope: Scope, kind: PlaceKind, placeSlug: string): Promise<LandingPage> {
  const index = await landingIndex(scope);
  const place = index.bySlug.get(slugKey(kind, placeSlug));
  if (!place || !placeShown(place)) return notFound(scope);
  const offers = await newestOffers(scope, { place });
  const title = heading(scope, undefined, place);
  const county = place.countyKey ? index.places.get(place.countyKey) : undefined;
  const region = place.regionKey ? index.places.get(place.regionKey) : undefined;
  const up = [county, region].filter((item): item is Place => !!item && placeShown(item)).map((item) => `<a href="${placePath(scope, item)}">${escapeHtml(heading(scope, undefined, item))}</a>`);
  const body = `<h1>${escapeHtml(title)}</h1>
<p>${counted(scope, place.total, " en cours")} ${escapeHtml(placePhrase(place))}. Les plus récentes :</p>
${offerList(offers)}
${place.kind === "city" ? `<p><a href="${escapeHtml(searchLink(scope, "", place))}">Rechercher autour de ${escapeHtml(place.name)}, avec un rayon et des filtres</a></p>` : ""}
${linkList(`Métiers qui recrutent ${placePhrase(place)}`, occupationLinks(scope, index, place, undefined, config.seo.landing.linksShown * 2))}
${place.kind === "region" ? linkList("Départements", placeLinks(scope, index, "county", { within: place })) : ""}
${place.kind !== "city" ? linkList("Villes", placeLinks(scope, index, "city", { within: place })) : ""}
${up.length ? `<p>${up.join(" · ")}</p>` : ""}
${linkList("Voir aussi", await otherScopes(scope, undefined, { kind, slug: place.slug }))}`;
  return { status: 200, html: document({ title, description: description(scope, place.total, `${placePhrase(place)}, tous métiers`), path: placePath(scope, place), body }) };
}

export async function pairPage(scope: Scope, occupationSlug: string, kind: PlaceKind, placeSlug: string): Promise<LandingPage> {
  const index = await landingIndex(scope);
  const occupation = index.occupations.get(occupationSlug);
  const place = index.bySlug.get(slugKey(kind, placeSlug));
  const count = occupation && place ? (index.pairs.get(pairKey(occupation.id, place.key)) ?? 0) : 0;
  if (!occupation || !place || !pairShown(count)) return notFound(scope);
  const offers = await newestOffers(scope, { occupationId: occupation.id, place });
  const title = heading(scope, occupation, place);
  const wider = [place.countyKey, place.regionKey]
    .map((key) => (key ? index.places.get(key) : undefined))
    .filter((item): item is Place => !!item && pairShown(index.pairs.get(pairKey(occupation.id, item.key))))
    .map((item) => `<a href="${pairPath(scope, occupation, item)}">${escapeHtml(heading(scope, occupation, item))}</a>`);
  const body = `<h1>${escapeHtml(title)}</h1>
<p>${counted(scope, count, " en cours")} ${escapeHtml(placePhrase(place))}. Les plus récentes :</p>
${offerList(offers)}
<p><a href="${escapeHtml(searchLink(scope, occupation.name, place))}">${place.kind === "city" ? `Rechercher autour de ${escapeHtml(place.name)}, avec un rayon et des filtres` : `Rechercher et filtrer toutes les offres ${escapeHtml(occupation.name)}`}</a></p>
${linkList(`${occupation.name} : autres lieux`, placeLinks(scope, index, place.kind, { occupation, except: place }))}
${linkList(`Autres métiers ${placePhrase(place)}`, occupationLinks(scope, index, place, occupation))}
<p>${[...wider, `<a href="${occupationPath(scope, occupation)}">${escapeHtml(heading(scope, occupation))} en France</a>`, ...(placeShown(place) ? [`<a href="${placePath(scope, place)}">${escapeHtml(heading(scope, undefined, place))}</a>`] : [])].join(" · ")}</p>
${linkList("Voir aussi", await otherScopes(scope, occupation.slug, { kind, slug: place.slug }))}`;
  return { status: 200, html: document({ title, description: description(scope, count, `${occupation.name} ${placePhrase(place)}`), path: pairPath(scope, occupation, place), body }) };
}
