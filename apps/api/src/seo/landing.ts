import { escapeHtml } from "@job/shared/src/markdown";
import { config } from "../config";
import { prisma } from "../lib/prisma";
import { appTemplate } from "./offer-page";

// Landing pages for the searches people type (SEO.md): /emplois (hub), /emplois/{métier},
// /emplois/{métier}/{ville-NN}, /emplois/a/{ville-NN}. Jobs are the ROME occupations (French
// names), places the towns; a page exists only with enough open public offers
// (config.seo.landing), so search engines get no thin pages. Plain server pages with the
// app's stylesheet: no app on top (its address handling would leave /emplois/…), links to
// offer pages and to the app's search.

type Occupation = { id: number; slug: string; name: string; total: number };
type City = { id: number; slug: string; name: string; countyCode: string | null; total: number };
type Index = { at: number; occupations: Map<string, Occupation>; cities: Map<string, City>; pairs: Map<string, number>; byOccupationId: Map<number, Occupation>; byCityId: Map<number, City> };

const REFRESH_MS = 3600 * 1000;
let cached: Index | null = null;
let loading: Promise<Index> | null = null;

export function slugify(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
}

const pairKey = (occupationId: number, cityId: number) => `${occupationId}:${cityId}`;

async function buildIndex(): Promise<Index> {
  const { minOccupation } = config.seo.landing;
  const [pairRows, cityRows] = await Promise.all([
    prisma.$queryRaw<{ occupation_id: number; location_id: number | null; count: bigint }[]>`
      SELECT oo.occupation_id, o.location_id, count(*) AS count
      FROM offers o
      JOIN offer_occupations oo ON oo.offer_id = o.id
      JOIN occupations occ ON occ.id = oo.occupation_id AND occ.source = 'rome'
      WHERE o.is_public AND o.closed_at IS NULL
      GROUP BY 1, 2`,
    prisma.$queryRaw<{ location_id: number; count: bigint }[]>`
      SELECT o.location_id, count(*) AS count
      FROM offers o JOIN locations l ON l.id = o.location_id AND l.type = 'city' AND l.country_code = 'FR'
      WHERE o.is_public AND o.closed_at IS NULL
      GROUP BY 1`,
  ]);

  const occupationTotals = new Map<number, number>();
  const pairs = new Map<string, number>();
  for (const row of pairRows) {
    occupationTotals.set(row.occupation_id, (occupationTotals.get(row.occupation_id) ?? 0) + Number(row.count));
    if (row.location_id !== null) pairs.set(pairKey(row.occupation_id, row.location_id), Number(row.count));
  }

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

  const cityIds = cityRows.map((row) => row.location_id);
  const locations = await prisma.location.findMany({ where: { id: { in: cityIds } }, select: { id: true, name: true, countyCode: true } });
  const cityTotals = new Map(cityRows.map((row) => [row.location_id, Number(row.count)]));
  const cities = new Map<string, City>();
  const byCityId = new Map<number, City>();
  for (const location of locations) {
    const slug = slugify(`${location.name}${location.countyCode ? `-${location.countyCode}` : ""}`);
    const city = { id: location.id, slug, name: location.name, countyCode: location.countyCode, total: cityTotals.get(location.id) ?? 0 };
    if (!slug || cities.has(slug)) continue;
    // Towns appear for pairs too, so all are kept; city pages need minCity offers.
    cities.set(slug, city);
    byCityId.set(location.id, city);
  }
  return { at: Date.now(), occupations, cities, pairs, byOccupationId, byCityId };
}

export async function landingIndex(): Promise<Index> {
  if (cached && Date.now() - cached.at < REFRESH_MS) return cached;
  loading ??= buildIndex().finally(() => {
    loading = null;
  });
  cached = await loading;
  return cached;
}

// Tests.
export function resetLandingIndex(): void {
  cached = null;
}

// Every landing page worth indexing, for the sitemap.
export async function landingPaths(): Promise<string[]> {
  const index = await landingIndex();
  const { minPair, minCity } = config.seo.landing;
  const paths = ["/emplois"];
  for (const occupation of index.occupations.values()) paths.push(`/emplois/${occupation.slug}`);
  for (const city of index.cities.values()) if (city.total >= minCity) paths.push(`/emplois/a/${city.slug}`);
  for (const [key, count] of index.pairs) {
    if (count < minPair) continue;
    const [occupationId, cityId] = key.split(":").map(Number);
    const occupation = index.byOccupationId.get(occupationId);
    const city = index.byCityId.get(cityId);
    if (occupation && city) paths.push(`/emplois/${occupation.slug}/${city.slug}`);
  }
  return paths.slice(0, config.seo.sitemapSize);
}

// --- Pages -------------------------------------------------------------------------------

type ListedOffer = { id: string; title: string; companyName: string | null; contractType: string | null; publishedAt: Date | null; createdAt: Date; location: { name: string; countyCode: string | null } | null };

const CONTRACTS: Record<string, string> = { permanent: "CDI", fixed_term: "CDD", temporary: "Intérim", freelance: "Freelance", internship: "Stage", apprenticeship: "Alternance", other: "Autre contrat" };
const shortDate = (date: Date) => new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", timeZone: "Europe/Paris" }).format(date);
const cityLabel = (city: City) => (city.countyCode ? `${city.name} (${city.countyCode})` : city.name);
const plural = (count: number, one: string, many: string) => `${new Intl.NumberFormat("fr-FR").format(count)} ${count > 1 ? many : one}`;

async function newestOffers(filter: { occupationId?: number; cityId?: number }): Promise<ListedOffer[]> {
  return prisma.offer.findMany({
    where: {
      isPublic: true,
      closedAt: null,
      ...(filter.occupationId !== undefined && { occupations: { some: { occupationId: filter.occupationId } } }),
      ...(filter.cityId !== undefined && { locationId: filter.cityId }),
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

const searchLink = (q: string, city?: City) => {
  const params = new URLSearchParams({ q, ...(city && { locationId: String(city.id), location: city.name }) });
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
      <p class="landing-top"><a href="/"><img src="/favicon.svg" alt="" width="20" height="20" /> ${escapeHtml(config.seo.siteName)}</a> · <a href="/emplois">Toutes les offres par métier et par ville</a></p>
      ${input.body}
      <p class="landing-foot"><a href="/emplois">Offres par métier et par ville</a> · <a href="/privacy">Confidentialité</a> · <a href="/terms">Conditions d'utilisation</a></p>
    </main>
  </body>
</html>`;
}

export type LandingPage = { status: number; html: string };

const notFound = (): LandingPage => ({ status: 404, html: document({ title: "Page introuvable", description: "Cette page n'existe pas ou plus.", path: "/emplois", noindex: true, body: `<h1>Page introuvable</h1><p>Il n'y a pas (ou plus) assez d'offres pour cette recherche. <a href="/emplois">Voir les offres par métier et par ville</a>.</p>` }) });

export async function hubPage(): Promise<LandingPage> {
  const index = await landingIndex();
  const occupations = [...index.occupations.values()].sort((a, b) => b.total - a.total).slice(0, config.seo.landing.linksShown * 3);
  const cities = [...index.cities.values()].filter((city) => city.total >= config.seo.landing.minCity).sort((a, b) => b.total - a.total).slice(0, config.seo.landing.linksShown * 3);
  const body = `<h1>Offres d'emploi par métier et par ville</h1>
<p>Les offres publiées par les employeurs, réunies sur ${escapeHtml(config.seo.siteName)} : choisissez un métier ou une ville, puis adaptez votre CV à chaque offre.</p>
${linkList("Métiers", occupations.map((occupation) => ({ href: `/emplois/${occupation.slug}`, label: `${occupation.name} (${occupation.total})` })))}
${linkList("Villes", cities.map((city) => ({ href: `/emplois/a/${city.slug}`, label: `${cityLabel(city)} (${city.total})` })))}`;
  return { status: 200, html: document({ title: "Offres d'emploi par métier et par ville", description: "Trouvez les offres d'emploi par métier et par ville, et adaptez votre CV à chacune.", path: "/emplois", body }) };
}

export async function occupationPage(occupationSlug: string): Promise<LandingPage> {
  const index = await landingIndex();
  const occupation = index.occupations.get(occupationSlug);
  if (!occupation) return notFound();
  const offers = await newestOffers({ occupationId: occupation.id });
  const cities = [...index.pairs]
    .filter(([key, count]) => key.startsWith(`${occupation.id}:`) && count >= config.seo.landing.minPair)
    .map(([key, count]) => ({ city: index.byCityId.get(Number(key.split(":")[1])), count }))
    .filter((item): item is { city: City; count: number } => !!item.city)
    .sort((a, b) => b.count - a.count)
    .slice(0, config.seo.landing.linksShown);
  const title = `Offres d'emploi ${occupation.name}`;
  const body = `<h1>${escapeHtml(title)}</h1>
<p>${plural(occupation.total, "offre en cours", "offres en cours")} en France. Les plus récentes :</p>
${offerList(offers)}
<p><a href="${escapeHtml(searchLink(occupation.name))}">Rechercher et filtrer toutes les offres ${escapeHtml(occupation.name)}</a></p>
${linkList(`${occupation.name} par ville`, cities.map(({ city, count }) => ({ href: `/emplois/${occupation.slug}/${city.slug}`, label: `${cityLabel(city)} (${count})` })))}`;
  return { status: 200, html: document({ title, description: `${plural(occupation.total, "offre", "offres")} d'emploi ${occupation.name} en France, mises à jour chaque jour. Postulez avec un CV adapté à chaque offre.`, path: `/emplois/${occupation.slug}`, body }) };
}

export async function pairPage(occupationSlug: string, citySlug: string): Promise<LandingPage> {
  const index = await landingIndex();
  const occupation = index.occupations.get(occupationSlug);
  const city = index.cities.get(citySlug);
  const count = occupation && city ? (index.pairs.get(pairKey(occupation.id, city.id)) ?? 0) : 0;
  if (!occupation || !city || count < config.seo.landing.minPair) return notFound();
  const offers = await newestOffers({ occupationId: occupation.id, cityId: city.id });
  const otherCities = [...index.pairs]
    .filter(([key, value]) => key.startsWith(`${occupation.id}:`) && key !== pairKey(occupation.id, city.id) && value >= config.seo.landing.minPair)
    .map(([key, value]) => ({ other: index.byCityId.get(Number(key.split(":")[1])), value }))
    .filter((item): item is { other: City; value: number } => !!item.other)
    .sort((a, b) => b.value - a.value)
    .slice(0, config.seo.landing.linksShown);
  const otherJobs = [...index.pairs]
    .filter(([key, value]) => key.endsWith(`:${city.id}`) && key !== pairKey(occupation.id, city.id) && value >= config.seo.landing.minPair)
    .map(([key, value]) => ({ other: index.byOccupationId.get(Number(key.split(":")[0])), value }))
    .filter((item): item is { other: Occupation; value: number } => !!item.other)
    .sort((a, b) => b.value - a.value)
    .slice(0, config.seo.landing.linksShown);
  const title = `Offres d'emploi ${occupation.name} à ${city.name}`;
  const body = `<h1>${escapeHtml(title)}</h1>
<p>${plural(count, "offre en cours", "offres en cours")} à ${escapeHtml(cityLabel(city))}. Les plus récentes :</p>
${offerList(offers)}
<p><a href="${escapeHtml(searchLink(occupation.name, city))}">Rechercher autour de ${escapeHtml(city.name)}, avec un rayon et des filtres</a></p>
${linkList(`${occupation.name} dans d'autres villes`, otherCities.map(({ other, value }) => ({ href: `/emplois/${occupation.slug}/${other.slug}`, label: `${cityLabel(other)} (${value})` })))}
${linkList(`Autres métiers à ${city.name}`, otherJobs.map(({ other, value }) => ({ href: `/emplois/${other.slug}/${city.slug}`, label: `${other.name} (${value})` })))}
<p><a href="/emplois/${occupation.slug}">Toutes les offres ${escapeHtml(occupation.name)} en France</a> · <a href="/emplois/a/${city.slug}">Toutes les offres à ${escapeHtml(city.name)}</a></p>`;
  return { status: 200, html: document({ title, description: `${plural(count, "offre", "offres")} d'emploi ${occupation.name} à ${cityLabel(city)}, mises à jour chaque jour. Postulez avec un CV adapté à chaque offre.`, path: `/emplois/${occupation.slug}/${city.slug}`, body }) };
}

export async function cityPage(citySlug: string): Promise<LandingPage> {
  const index = await landingIndex();
  const city = index.cities.get(citySlug);
  if (!city || city.total < config.seo.landing.minCity) return notFound();
  const offers = await newestOffers({ cityId: city.id });
  const jobs = [...index.pairs]
    .filter(([key, value]) => key.endsWith(`:${city.id}`) && value >= config.seo.landing.minPair)
    .map(([key, value]) => ({ occupation: index.byOccupationId.get(Number(key.split(":")[0])), value }))
    .filter((item): item is { occupation: Occupation; value: number } => !!item.occupation)
    .sort((a, b) => b.value - a.value)
    .slice(0, config.seo.landing.linksShown * 2);
  const title = `Offres d'emploi à ${city.name}`;
  const body = `<h1>${escapeHtml(title)}</h1>
<p>${plural(city.total, "offre en cours", "offres en cours")} à ${escapeHtml(cityLabel(city))}. Les plus récentes :</p>
${offerList(offers)}
${linkList(`Métiers qui recrutent à ${city.name}`, jobs.map(({ occupation, value }) => ({ href: `/emplois/${occupation.slug}/${city.slug}`, label: `${occupation.name} (${value})` })))}`;
  return { status: 200, html: document({ title, description: `${plural(city.total, "offre", "offres")} d'emploi à ${cityLabel(city)}, tous métiers, mises à jour chaque jour. Postulez avec un CV adapté à chaque offre.`, path: `/emplois/a/${city.slug}`, body }) };
}
