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

type Occupation = { id: number; slug: string; name: string; total: number; parentId: number | null };
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
  const [names, parents] = await Promise.all([
    prisma.occupationName.findMany({ where: { occupationId: { in: occupationIds }, isCanonical: true, language: "fr" }, select: { occupationId: true, name: true } }),
    prisma.occupation.findMany({ where: { id: { in: occupationIds } }, select: { id: true, parentId: true } }),
  ]);
  const parentOf = new Map(parents.map((row) => [row.id, row.parentId]));
  const occupations = new Map<string, Occupation>();
  const byOccupationId = new Map<number, Occupation>();
  for (const { occupationId, name } of names) {
    const slug = slugify(name);
    if (!slug || occupations.has(slug)) continue;
    const occupation = { id: occupationId, slug, name, total: occupationTotals.get(occupationId) ?? 0, parentId: parentOf.get(occupationId) ?? null };
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
  statsCache.clear();
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

// --- What the page's offers say: contracts, salaries, remote work, employers, skills ---------

type Stats = {
  total: number;
  recent: number; // published in the last 7 days
  contracts: [string, number][];
  remote: number; // fully remote or hybrid
  salary: { count: number; low: number; median: number; high: number } | null; // yearly, gross, EUR
  employers: { name: string; count: number }[];
  skills: string[];
};

const STATS_TTL_MS = 3600 * 1000;
const STATS_KEPT = 5000;
const statsCache = new Map<string, { at: number; stats: Stats }>();

// The page's offers as SQL: the scope's contract, the job, the place.
function offerFilter(scope: Scope, filter: { occupationId?: number; place?: Place }) {
  const place = filter.place;
  return Prisma.sql`o.is_public AND o.closed_at IS NULL
    ${scope.contract ? Prisma.sql`AND o.contract_type = ${scope.contract}::contract_type` : Prisma.empty}
    ${filter.occupationId !== undefined ? Prisma.sql`AND EXISTS (SELECT 1 FROM offer_occupations oo WHERE oo.offer_id = o.id AND oo.occupation_id = ${filter.occupationId})` : Prisma.empty}
    ${place?.kind === "city" ? Prisma.sql`AND o.location_id = ${place.locationId}` : Prisma.empty}
    ${place?.kind === "county" ? Prisma.sql`AND o.location_id IN (SELECT id FROM locations WHERE country_code = 'FR' AND county_code = ${place.countyCode})` : Prisma.empty}
    ${place?.kind === "region" ? Prisma.sql`AND o.location_id IN (SELECT id FROM locations WHERE country_code = 'FR' AND region_name = ${place.regionName})` : Prisma.empty}`;
}

// A salary as a yearly gross amount: the middle of its range, times the hours, days or months
// of a full-time year (1 607 h, 218 days).
const YEARLY = Prisma.sql`(CASE o.salary_period WHEN 'year' THEN 1 WHEN 'month' THEN 12 WHEN 'day' THEN 218 WHEN 'hour' THEN 1607 END)
  * (coalesce(o.salary_min, o.salary_max) + coalesce(o.salary_max, o.salary_min)) / 2.0`;

export async function pageStats(scope: Scope, filter: { occupationId?: number; place?: Place }): Promise<Stats> {
  const key = `${scope.key}|${filter.occupationId ?? ""}|${filter.place?.key ?? ""}`;
  const hit = statsCache.get(key);
  if (hit && Date.now() - hit.at < STATS_TTL_MS) return hit.stats;
  const where = offerFilter(scope, filter);
  // Internships and apprenticeships pay a few hundred euros a month: a lower floor.
  const floor = scope.contract ? 3000 : 12000;
  const [contractRows, salaryRows, employerRows, skillRows] = await Promise.all([
    prisma.$queryRaw<{ contract: string | null; count: bigint; remote: bigint; recent: bigint }[]>`
      SELECT o.contract_type::text AS contract, count(*) AS count,
        count(*) FILTER (WHERE o.remote_type IN ('remote', 'hybrid')) AS remote,
        count(*) FILTER (WHERE coalesce(o.published_at, o.created_at) > now() - interval '7 days') AS recent
      FROM offers o WHERE ${where} GROUP BY 1`,
    prisma.$queryRaw<{ count: bigint; low: number | null; median: number | null; high: number | null }[]>`
      SELECT count(*) AS count,
        percentile_cont(0.25) WITHIN GROUP (ORDER BY yearly) AS low,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY yearly) AS median,
        percentile_cont(0.75) WITHIN GROUP (ORDER BY yearly) AS high
      FROM (SELECT ${YEARLY} AS yearly FROM offers o
            WHERE ${where} AND o.salary_currency = 'EUR' AND o.salary_period IS NOT NULL AND coalesce(o.salary_min, o.salary_max) IS NOT NULL) s
      WHERE yearly BETWEEN ${floor} AND 300000`,
    prisma.$queryRaw<{ name: string; count: bigint }[]>`
      SELECT coalesce(c.name, o.company_name) AS name, count(*) AS count
      FROM offers o LEFT JOIN companies c ON c.id = o.company_id
      WHERE ${where} AND coalesce(c.name, o.company_name) IS NOT NULL
      GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 8`,
    filter.occupationId === undefined
      ? Promise.resolve([] as { name: string }[])
      : prisma.$queryRaw<{ name: string; count: bigint }[]>`
      SELECT sn.name, count(*) AS count FROM offer_skills os
      JOIN offers o ON o.id = os.offer_id
      JOIN skill_names sn ON sn.skill_id = os.skill_id AND sn.language = 'fr' AND sn.is_canonical
      WHERE ${where} GROUP BY sn.name ORDER BY count(*) DESC, sn.name LIMIT 20`,
  ]);
  const total = contractRows.reduce((sum, row) => sum + Number(row.count), 0);
  const salary = salaryRows[0] && Number(salaryRows[0].count) >= config.seo.landing.minSalaries && salaryRows[0].median !== null ? { count: Number(salaryRows[0].count), low: salaryRows[0].low!, median: salaryRows[0].median, high: salaryRows[0].high! } : null;
  const stats: Stats = {
    total,
    recent: contractRows.reduce((sum, row) => sum + Number(row.recent), 0),
    remote: contractRows.reduce((sum, row) => sum + Number(row.remote), 0),
    contracts: contractRows.filter((row) => row.contract).map((row) => [row.contract!, Number(row.count)] as [string, number]).sort((a, b) => b[1] - a[1]),
    salary,
    employers: employerRows.map((row) => ({ name: row.name, count: Number(row.count) })),
    skills: commonSkills(skillRows.map((row) => ({ name: row.name, count: Number("count" in row ? row.count : 0) })), total),
  };
  if (statsCache.size >= STATS_KEPT) statsCache.delete(statsCache.keys().next().value!);
  statsCache.set(key, { at: Date.now(), stats });
  return stats;
}

// Skills found in enough of the page's offers (5 %, at least 3: fewer is noise from the
// skill matching), one of each family ("Travail en équipe", "travailler en équipe").
// Skills the matching finds in ordinary words ("notre histoire"): not shown.
const NOISY_SKILLS = new Set(["histoire", "modelisation-orientee-services", "communication-electronique"]);

export function commonSkills(rows: { name: string; count: number }[], total: number): string[] {
  const kept: string[] = [];
  const stems = new Set<string>();
  for (const { name, count } of rows) {
    if (count < Math.max(3, total * 0.05) || NOISY_SKILLS.has(slugify(name))) continue;
    const stem = slugify(name).split("-").map((word) => word.slice(0, 5)).join("-");
    if (stems.has(stem)) continue;
    stems.add(stem);
    kept.push(name.charAt(0).toUpperCase() + name.slice(1));
  }
  return kept.slice(0, 10);
}

const percent = (part: number, whole: number) => Math.round((100 * part) / whole);
const euros = (amount: number) => `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Math.round(amount / 100) * 100)} €`;

// The page's summary in sentences: only what the data supports.
export function summary(scope: Scope, stats: Stats, where: string): string {
  if (!stats.total) return "";
  const sentences: string[] = [];
  sentences.push(`${counted(scope, stats.total, " en cours")} ${where}${stats.recent ? `, dont ${number(stats.recent)} publiée${stats.recent > 1 ? "s" : ""} ces 7 derniers jours` : ""}.`);
  if (!scope.contract) {
    const typed = stats.contracts.reduce((sum, [, count]) => sum + count, 0);
    const shares = stats.contracts.filter(([, count]) => typed >= 10 && percent(count, typed) >= 5).slice(0, 4).map(([contract, count]) => `${percent(count, typed)} % ${CONTRACT_PHRASES[contract] ?? contract}`);
    if (shares.length >= 2) sentences.push(`Contrats proposés : ${shares.join(", ")}.`);
  }
  if (stats.total >= 10 && percent(stats.remote, stats.total) >= 5) sentences.push(`${percent(stats.remote, stats.total)} % des offres permettent le télétravail, complet ou partiel.`);
  if (stats.salary) {
    const { low, median, high, count } = stats.salary;
    const monthly = !!scope.contract;
    const unit = monthly ? "brut par mois" : "brut par an";
    const show = (amount: number) => euros(monthly ? amount / 12 : amount);
    sentences.push(
      low === high
        ? `Salaire annoncé : ${show(median)} ${unit} (sur ${number(count)} offres qui l'indiquent).`
        : `Salaire annoncé : entre ${show(low)} et ${show(high)} ${unit} pour la moitié des offres qui l'indiquent, ${show(median)} en valeur médiane (sur ${number(count)} offres).`,
    );
  }
  const employers = stats.employers.filter((employer) => employer.count >= 2).slice(0, 5);
  if (employers.length >= 2) sentences.push(`Employeurs qui recrutent le plus : ${employers.map((employer) => `${employer.name} (${number(employer.count)})`).join(", ")}.`);
  if (stats.skills.length >= 3) sentences.push(`Compétences les plus demandées : ${stats.skills.slice(0, 8).join(", ")}.`);
  return `<h2>En bref</h2><p class="landing-summary">${sentences.map(escapeHtml).join(" ")}</p>`;
}

const CONTRACT_PHRASES: Record<string, string> = { permanent: "en CDI", fixed_term: "en CDD", temporary: "en intérim", freelance: "en freelance", internship: "en stage", apprenticeship: "en alternance", other: "autres contrats" };

// Short descriptions for search results: the count, the salary when known.
function metaDescription(scope: Scope, stats: Stats, count: number, what: string): string {
  const salary = stats.salary ? ` Salaire médian annoncé : ${euros(scope.contract ? stats.salary.median / 12 : stats.salary.median)} ${scope.contract ? "brut/mois" : "brut/an"}.` : "";
  return `${counted(scope, count)} ${what}, mises à jour chaque jour.${salary} Postulez avec un CV adapté à chaque offre.`;
}

// Jobs next to this one in the ROME catalogue (same parent), as links in the same place
// when that page exists, else across France.
function relatedJobs(scope: Scope, index: Index, occupation: Occupation, place?: Place) {
  if (occupation.parentId === null) return [];
  return [...index.occupations.values()]
    .filter((other) => other !== occupation && other.parentId === occupation.parentId)
    .map((other) => {
      const count = place ? index.pairs.get(pairKey(other.id, place.key)) : undefined;
      return place && pairShown(count) ? { href: pairPath(scope, other, place), label: `${other.name} (${number(count!)})`, count: count! } : { href: occupationPath(scope, other), label: `${other.name} (${number(other.total)})`, count: other.total };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
}

// The trail above the heading, and the same as schema.org BreadcrumbList.
type Crumb = { name: string; path: string };
function breadcrumbs(crumbs: Crumb[]): { html: string; data: Record<string, unknown> } {
  const html = `<nav class="landing-crumbs" aria-label="Fil d'Ariane">${crumbs.map((crumb, position) => (position === crumbs.length - 1 ? `<span>${escapeHtml(crumb.name)}</span>` : `<a href="${escapeHtml(crumb.path)}">${escapeHtml(crumb.name)}</a>`)).join(" › ")}</nav>`;
  const data = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((crumb, position) => ({ "@type": "ListItem", position: position + 1, name: crumb.name, item: `${config.webBaseUrl}${crumb.path}` })),
  };
  return { html, data };
}

// The trail of a place: its region and département when their pages exist, then itself.
function placeCrumbs(scope: Scope, index: Index, place: Place, occupation?: Occupation): Crumb[] {
  const chain = [place.regionKey, place.countyKey].map((key) => (key ? index.places.get(key) : undefined)).filter((item): item is Place => !!item);
  const crumbs: Crumb[] = [];
  // A département named like its town (Paris) isn't repeated.
  for (const item of [...chain.filter((item) => item.name !== place.name), place]) {
    const shown = occupation ? pairShown(index.pairs.get(pairKey(occupation.id, item.key))) : placeShown(item);
    if (shown || item === place) crumbs.push({ name: item.kind === "city" ? item.name : item.label, path: occupation ? pairPath(scope, occupation, item) : placePath(scope, item) });
  }
  return crumbs;
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

// Structured data in the page, unable to end its block early.
const jsonLd = (data: Record<string, unknown>) => `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`;

// The page around the content: the app's stylesheet and theme, a header, links at the end.
function document(input: { title: string; description: string; path: string; body: string; noindex?: boolean; data?: Record<string, unknown>[] }): string {
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
    ${(input.data ?? []).map(jsonLd).join("\n    ")}
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

const hubCrumb = (scope: Scope): Crumb => ({ name: scope.noun, path: scope.prefix });

export async function hubPage(scope: Scope): Promise<LandingPage> {
  const index = await landingIndex(scope);
  const { linksShown } = config.seo.landing;
  const stats = await pageStats(scope, {});
  const body = `<h1>${escapeHtml(scope.hubTitle)}</h1>
<p>Les offres publiées par les employeurs, réunies sur ${escapeHtml(config.seo.siteName)} : choisissez un métier ou un lieu, puis adaptez votre CV à chaque offre.</p>
${summary(scope, stats, "en France")}
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
  const [offers, stats] = await Promise.all([newestOffers(scope, { occupationId: occupation.id }), pageStats(scope, { occupationId: occupation.id })]);
  const title = heading(scope, occupation);
  const trail = breadcrumbs([hubCrumb(scope), { name: occupation.name, path: occupationPath(scope, occupation) }]);
  const body = `${trail.html}
<h1>${escapeHtml(title)}</h1>
${summary(scope, stats, "en France")}
<h2>Les offres les plus récentes</h2>
${offerList(offers)}
<p><a href="${escapeHtml(searchLink(scope, occupation.name))}">Rechercher et filtrer toutes les offres ${escapeHtml(occupation.name)}</a></p>
${linkList(`${occupation.name} par région`, placeLinks(scope, index, "region", { occupation, limit: 30 }))}
${linkList(`${occupation.name} par département`, placeLinks(scope, index, "county", { occupation }))}
${linkList(`${occupation.name} par ville`, placeLinks(scope, index, "city", { occupation }))}
${linkList("Métiers proches", relatedJobs(scope, index, occupation))}
${linkList("Voir aussi", await otherScopes(scope, occupation.slug))}`;
  return { status: 200, html: document({ title, description: metaDescription(scope, stats, occupation.total, `${occupation.name} en France`), path: occupationPath(scope, occupation), body, data: [trail.data] }) };
}

export async function placePage(scope: Scope, kind: PlaceKind, placeSlug: string): Promise<LandingPage> {
  const index = await landingIndex(scope);
  const place = index.bySlug.get(slugKey(kind, placeSlug));
  if (!place || !placeShown(place)) return notFound(scope);
  const [offers, stats] = await Promise.all([newestOffers(scope, { place }), pageStats(scope, { place })]);
  const title = heading(scope, undefined, place);
  const trail = breadcrumbs([hubCrumb(scope), ...placeCrumbs(scope, index, place)]);
  const body = `${trail.html}
<h1>${escapeHtml(title)}</h1>
${summary(scope, stats, placePhrase(place))}
<h2>Les offres les plus récentes</h2>
${offerList(offers)}
${place.kind === "city" ? `<p><a href="${escapeHtml(searchLink(scope, "", place))}">Rechercher autour de ${escapeHtml(place.name)}, avec un rayon et des filtres</a></p>` : ""}
${linkList(`Métiers qui recrutent ${placePhrase(place)}`, occupationLinks(scope, index, place, undefined, config.seo.landing.linksShown * 2))}
${place.kind === "region" ? linkList("Départements", placeLinks(scope, index, "county", { within: place })) : ""}
${place.kind !== "city" ? linkList("Villes", placeLinks(scope, index, "city", { within: place })) : ""}
${linkList("Voir aussi", await otherScopes(scope, undefined, { kind, slug: place.slug }))}`;
  return { status: 200, html: document({ title, description: metaDescription(scope, stats, place.total, `${placePhrase(place)}, tous métiers`), path: placePath(scope, place), body, data: [trail.data] }) };
}

export async function pairPage(scope: Scope, occupationSlug: string, kind: PlaceKind, placeSlug: string): Promise<LandingPage> {
  const index = await landingIndex(scope);
  const occupation = index.occupations.get(occupationSlug);
  const place = index.bySlug.get(slugKey(kind, placeSlug));
  const count = occupation && place ? (index.pairs.get(pairKey(occupation.id, place.key)) ?? 0) : 0;
  if (!occupation || !place || !pairShown(count)) return notFound(scope);
  const [offers, stats] = await Promise.all([newestOffers(scope, { occupationId: occupation.id, place }), pageStats(scope, { occupationId: occupation.id, place })]);
  const title = heading(scope, occupation, place);
  const trail = breadcrumbs([hubCrumb(scope), { name: occupation.name, path: occupationPath(scope, occupation) }, ...placeCrumbs(scope, index, place, occupation)]);
  const body = `${trail.html}
<h1>${escapeHtml(title)}</h1>
${summary(scope, stats, placePhrase(place))}
<h2>Les offres les plus récentes</h2>
${offerList(offers)}
<p><a href="${escapeHtml(searchLink(scope, occupation.name, place))}">${place.kind === "city" ? `Rechercher autour de ${escapeHtml(place.name)}, avec un rayon et des filtres` : `Rechercher et filtrer toutes les offres ${escapeHtml(occupation.name)}`}</a></p>
${linkList(`${occupation.name} : autres lieux`, placeLinks(scope, index, place.kind, { occupation, except: place }))}
${linkList(`Métiers proches ${placePhrase(place)}`, relatedJobs(scope, index, occupation, place))}
${linkList(`Autres métiers ${placePhrase(place)}`, occupationLinks(scope, index, place, occupation))}
<p><a href="${occupationPath(scope, occupation)}">${escapeHtml(heading(scope, occupation))} en France</a>${placeShown(place) ? ` · <a href="${placePath(scope, place)}">${escapeHtml(heading(scope, undefined, place))}</a>` : ""}</p>
${linkList("Voir aussi", await otherScopes(scope, occupation.slug, { kind, slug: place.slug }))}`;
  return { status: 200, html: document({ title, description: metaDescription(scope, stats, count, `${occupation.name} ${placePhrase(place)}`), path: pairPath(scope, occupation, place), body, data: [trail.data] }) };
}
