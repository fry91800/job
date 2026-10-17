import { Prisma, type Location } from "@prisma/client";
import {
  SEARCH_PAGE_SIZE,
  type ContractType,
  type LocationMatch,
  type OfferSearchParams,
  type OfferSearchResponse,
  type OfferSearchResult,
  type RemoteType,
  type SalaryPeriod,
} from "@job/shared";
import { HttpError } from "../lib/http-error";
import { prisma } from "../lib/prisma";

const { sql, join } = Prisma;

const MAX_KEYWORDS = 8;
const EARTH_RADIUS_KM = 6371;
const KM_PER_DEGREE = 111.32;

const publishedWithinIntervals = { "24h": "24 hours", "7d": "7 days", "30d": "30 days" } as const;

type OfferRow = {
  id: string;
  title: string;
  company_name: string | null;
  remote_type: RemoteType | null;
  contract_type: ContractType | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  salary_period: SalaryPeriod | null;
  published_at: Date | null;
  created_at: Date;
  location_id: number | null;
  location_type: "city" | "county" | "region" | "country" | null;
  location_name: string | null;
  country_code: string | null;
  region_name: string | null;
  county_name: string | null;
  location_match: LocationMatch | null;
  distance_km: number | null;
};

function groupBy<T, V>(items: T[], key: (item: T) => string, value: (item: T) => V): Map<string, V[]> {
  const groups = new Map<string, V[]>();
  for (const item of items) {
    const group = groups.get(key(item));
    if (group) group.push(value(item));
    else groups.set(key(item), [value(item)]);
  }
  return groups;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

// Words that would match almost every offer ("chef DE projet").
const STOP_WORDS = new Set([
  "a", "à", "au", "aux", "d", "de", "des", "du", "en", "et", "l", "la", "le", "les", "ou", "par", "pour", "sur", "un", "une",
  "an", "and", "at", "for", "in", "of", "on", "or", "the", "to", "h", "f", "hf", "fh", "x",
]);

export function searchWords(q: string): string[] {
  const words = q
    .split(/[\s'’/()]+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 0 && !STOP_WORDS.has(word.toLowerCase()));
  return words.slice(0, MAX_KEYWORDS);
}

// Each keyword must match the title (substring, or trigram word similarity so missing
// accents and small typos still match), the company name, or a linked occupation name.
// Written as a union of offer ids, each part answered by an index (trigram indexes on
// offers.title, offers.company_name and occupation_names.name): an OR of the same tests
// would be evaluated offer by offer (26 s for "chef de projet" on 35 000 offers).
function keywordConditions(q: string): Prisma.Sql[] {
  return searchWords(q).map((word) => {
    const pattern = `%${escapeLike(word)}%`;
    return sql`o.id IN (
      SELECT id FROM offers WHERE title ILIKE ${pattern}
      UNION SELECT id FROM offers WHERE ${word} <% title
      UNION SELECT id FROM offers WHERE company_name ILIKE ${pattern}
      UNION SELECT offer_id FROM offer_occupations WHERE occupation_id = ANY (ARRAY(
        SELECT DISTINCT occupation_id FROM occupation_names WHERE name ILIKE ${pattern} OR ${word} <% name
      ))
    )`;
  });
}

function salaryCondition(params: OfferSearchParams): Prisma.Sql | null {
  if (params.salaryMin === undefined) {
    return params.salaryShownOnly ? sql`o.salary_min IS NOT NULL` : null;
  }
  // Only offers with the same currency and period can be compared.
  const comparable = sql`(
    o.salary_currency = ${params.salaryCurrency}
    AND o.salary_period::text = ${params.salaryPeriod}
    AND COALESCE(o.salary_max, o.salary_min) >= ${params.salaryMin}
  )`;
  return params.salaryShownOnly ? comparable : sql`(o.salary_min IS NULL OR ${comparable})`;
}

type LocationFilter = {
  condition: Prisma.Sql;
  match: Prisma.Sql; // evaluates to a LocationMatch
  distance: Prisma.Sql; // km for city offers in a city search, else NULL
};

// Matching rules from DATABASE.md "locations": codes for areas, radius for cities,
// offers located in a larger area are `wider_area`, fully remote offers in the same
// country are `remote` when includeRemote is on.
function locationFilter(searched: Location, radiusKm: number, includeRemote: boolean): LocationFilter {
  let exact: Prisma.Sql;
  let widerArea: Prisma.Sql;
  let distance: Prisma.Sql = sql`NULL::float8`;

  switch (searched.type) {
    case "city": {
      if (searched.latitude !== null && searched.longitude !== null && radiusKm > 0) {
        const lat = searched.latitude;
        const lon = searched.longitude;
        const latDelta = radiusKm / KM_PER_DEGREE;
        const lonDelta = radiusKm / (KM_PER_DEGREE * Math.cos((lat * Math.PI) / 180));
        distance = sql`CASE WHEN l.type = 'city' THEN ${EARTH_RADIUS_KM}::float8 * 2 * asin(sqrt(
          power(sin(radians(l.latitude - ${lat}::float8) / 2), 2)
          + cos(radians(${lat}::float8)) * cos(radians(l.latitude)) * power(sin(radians(l.longitude - ${lon}::float8) / 2), 2)
        )) END`;
        exact = sql`(l.type = 'city' AND (l.id = ${searched.id} OR (
          l.latitude BETWEEN ${lat - latDelta}::float8 AND ${lat + latDelta}::float8
          AND l.longitude BETWEEN ${lon - lonDelta}::float8 AND ${lon + lonDelta}::float8
          AND ${distance} <= ${radiusKm}::float8
        )))`;
      } else {
        exact = sql`l.id = ${searched.id}`;
      }
      widerArea = sql`(
        (l.type = 'county' AND l.country_code = ${searched.countryCode} AND l.county_code = ${searched.countyCode})
        OR (l.type = 'region' AND l.region_code = ${searched.regionCode})
        OR (l.type = 'country' AND l.country_code = ${searched.countryCode})
      )`;
      break;
    }
    case "county":
      exact = sql`(l.country_code = ${searched.countryCode} AND l.county_code = ${searched.countyCode})`;
      widerArea = sql`(
        (l.type = 'region' AND l.region_code = ${searched.regionCode})
        OR (l.type = 'country' AND l.country_code = ${searched.countryCode})
      )`;
      break;
    case "region":
      exact = sql`l.region_code = ${searched.regionCode}`;
      widerArea = sql`(l.type = 'country' AND l.country_code = ${searched.countryCode})`;
      break;
    case "country":
      exact = sql`l.country_code = ${searched.countryCode}`;
      widerArea = sql`FALSE`;
      break;
  }

  const remote = includeRemote
    ? sql`(o.remote_type = 'remote' AND (o.location_id IS NULL OR l.country_code = ${searched.countryCode}))`
    : sql`FALSE`;

  return {
    // COALESCE: comparisons with a NULL location (offer without location) count as false.
    condition: sql`(COALESCE(${exact}, FALSE) OR COALESCE(${widerArea}, FALSE) OR ${remote})`,
    match: sql`CASE
      WHEN COALESCE(${exact}, FALSE) THEN 'exact'
      WHEN COALESCE(${widerArea}, FALSE) THEN 'wider_area'
      WHEN ${remote} THEN 'remote'
    END`,
    distance,
  };
}

// `collectedAfter`: only offers that arrived after that moment (job alerts).
export async function searchOffers(params: OfferSearchParams, userId?: string, options: { collectedAfter?: Date } = {}): Promise<OfferSearchResponse> {
  const conditions: Prisma.Sql[] = [sql`o.is_public`, sql`o.closed_at IS NULL`];
  if (options.collectedAfter) conditions.push(sql`o.created_at > ${options.collectedAfter}`);

  if (params.q) conditions.push(...keywordConditions(params.q));
  if (params.company) conditions.push(sql`o.company_name ILIKE ${`%${escapeLike(params.company)}%`}`);
  if (params.skills.length > 0) {
    conditions.push(sql`EXISTS (SELECT 1 FROM offer_skills os WHERE os.offer_id = o.id AND os.skill_id IN (${join(params.skills)}))`);
  }
  if (params.remoteType.length > 0) conditions.push(sql`o.remote_type::text IN (${join(params.remoteType)})`);
  if (params.contractType.length > 0) conditions.push(sql`o.contract_type::text IN (${join(params.contractType)})`);
  if (params.publishedWithin) {
    conditions.push(sql`o.published_at >= now() - ${publishedWithinIntervals[params.publishedWithin]}::interval`);
  }
  const salary = salaryCondition(params);
  if (salary) conditions.push(salary);

  let location: LocationFilter | null = null;
  if (params.locationId !== undefined) {
    const searched = await prisma.location.findUnique({ where: { id: params.locationId } });
    if (!searched) throw new HttpError(400, "unknown_location", "The searched location does not exist");
    location = locationFilter(searched, params.radius, params.includeRemote);
    conditions.push(location.condition);
  }

  const where = join(conditions, " AND ");
  const from = sql`FROM offers o LEFT JOIN locations l ON l.id = o.location_id`;

  // Offers located in a wider area always come after exact matches (FEATURE O1).
  const order: Prisma.Sql[] = [];
  if (location) order.push(sql`(${location.match}) = 'wider_area'`);
  if (params.sort === "relevance") {
    if (params.skills.length > 0) {
      order.push(sql`(SELECT count(*) FROM offer_skills os WHERE os.offer_id = o.id AND os.skill_id IN (${join(params.skills)})) DESC`);
    }
    if (params.q) order.push(sql`word_similarity(${params.q}, o.title) DESC`);
  }
  order.push(sql`o.published_at DESC NULLS LAST`, sql`o.id`);

  const [countRows, rows] = await Promise.all([
    prisma.$queryRaw<{ total: number }[]>`SELECT count(*)::int AS total ${from} WHERE ${where}`,
    prisma.$queryRaw<OfferRow[]>`
      SELECT
        o.id, o.title, o.company_name,
        o.remote_type::text AS remote_type, o.contract_type::text AS contract_type,
        o.salary_min, o.salary_max, o.salary_currency, o.salary_period::text AS salary_period,
        o.published_at, o.created_at,
        l.id AS location_id, l.type::text AS location_type, l.name AS location_name,
        l.country_code, l.region_name, l.county_name,
        ${location ? location.match : sql`NULL`} AS location_match,
        ${location ? location.distance : sql`NULL::float8`} AS distance_km
      ${from}
      WHERE ${where}
      ORDER BY ${join(order, ", ")}
      LIMIT ${SEARCH_PAGE_SIZE} OFFSET ${(params.page - 1) * SEARCH_PAGE_SIZE}
    `,
  ]);

  const total = countRows[0]?.total ?? 0;
  const ids = rows.map((row) => row.id);

  const [offerSkills, offerOccupations, savedOffers] = await Promise.all([
    prisma.offerSkill.findMany({ where: { offerId: { in: ids } }, select: { offerId: true, skillId: true } }),
    prisma.offerOccupation.findMany({ where: { offerId: { in: ids } }, select: { offerId: true, occupationId: true } }),
    userId
      ? prisma.savedOffer.findMany({ where: { userId, offerId: { in: ids } }, select: { offerId: true, status: true } })
      : Promise.resolve([]),
  ]);
  const skillIds = groupBy(offerSkills, (item) => item.offerId, (item) => item.skillId);
  const occupationIds = groupBy(offerOccupations, (item) => item.offerId, (item) => item.occupationId);
  const savedStatus = new Map(savedOffers.map((item) => [item.offerId, item.status]));

  const results: OfferSearchResult[] = rows.map((row) => ({
    id: row.id,
    title: row.title,
    companyName: row.company_name,
    location: row.location_id === null ? null : {
      id: row.location_id,
      type: row.location_type!,
      name: row.location_name!,
      countryCode: row.country_code!,
      regionName: row.region_name,
      countyName: row.county_name,
    },
    locationMatch: row.location_match,
    distanceKm: row.distance_km === null ? null : Math.round(row.distance_km * 10) / 10,
    remoteType: row.remote_type,
    contractType: row.contract_type,
    salary: row.salary_currency && row.salary_period
      ? { min: row.salary_min, max: row.salary_max, currency: row.salary_currency, period: row.salary_period }
      : null,
    publishedAt: row.published_at?.toISOString() ?? null,
    collectedAt: row.created_at.toISOString(),
    saved: savedStatus.has(row.id) ? { status: savedStatus.get(row.id)! } : null,
    skillIds: skillIds.get(row.id) ?? [],
    occupationIds: occupationIds.get(row.id) ?? [],
  }));

  return {
    results,
    page: params.page,
    pageSize: SEARCH_PAGE_SIZE,
    total,
    totalPages: Math.ceil(total / SEARCH_PAGE_SIZE),
  };
}
