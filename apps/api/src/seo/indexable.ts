import { Prisma } from "@prisma/client";
import { config } from "../config";
import { prisma } from "../lib/prisma";

// Which offer pages search engines should index (SEO.md "Only our best offers"). A new
// domain gets a small crawl budget, and thin or repeated pages lower the whole site:
// * open public offers with JobPosting (a company, and a place or fully remote);
// * a description of at least `config.seo.minDescriptionLength` characters — shorter
//   ("Voir l'annonce", three lines) is noindex;
// * one offer per group of copies (the same employer, title and place: Foncia posts
//   "Consultant immobilier indépendant" 32 times): the most complete, then the newest;
//   the others point to it (rel=canonical).
// The others stay visible to visitors; they leave the sitemaps and the engines'
// notifications, and carry no JobPosting.

const COMPANY_KEY = Prisma.sql`coalesce(o.company_id::text, lower(o.company_name))`;
const TITLE_KEY = Prisma.sql`lower(regexp_replace(o.title, '\\s+', ' ', 'g'))`;
const RANK = Prisma.sql`o.quality_score DESC NULLS LAST, coalesce(o.published_at, o.created_at) DESC, o.id`;
const eligible = () => Prisma.sql`o.is_public AND o.closed_at IS NULL
  AND (o.company_id IS NOT NULL OR o.company_name IS NOT NULL)
  AND (o.location_id IS NOT NULL OR o.remote_type = 'remote')
  AND length(o.description) >= ${config.seo.minDescriptionLength}`;

export type Indexing = { indexable: true } | { indexable: false; reason: "thin" | "copy" | "closed"; canonicalId?: string };

// One offer's verdict, and the offer its copies point to.
export async function offerIndexing(id: string): Promise<Indexing> {
  const [row] = await prisma.$queryRaw<{ closed: boolean; thin: boolean; representative: string | null }[]>`
    SELECT o.closed_at IS NOT NULL AS closed,
      (length(o.description) < ${config.seo.minDescriptionLength}) AS thin,
      (SELECT r.id FROM offers r
        WHERE coalesce(r.company_id::text, lower(r.company_name)) = ${COMPANY_KEY}
          AND lower(regexp_replace(r.title, '\\s+', ' ', 'g')) = ${TITLE_KEY}
          AND r.location_id IS NOT DISTINCT FROM o.location_id
          AND r.is_public AND r.closed_at IS NULL AND length(r.description) >= ${config.seo.minDescriptionLength}
          AND (r.company_id IS NOT NULL OR r.company_name IS NOT NULL) AND (r.location_id IS NOT NULL OR r.remote_type = 'remote')
        ORDER BY r.quality_score DESC NULLS LAST, coalesce(r.published_at, r.created_at) DESC, r.id
        LIMIT 1) AS representative
    FROM offers o WHERE o.id = ${id}::uuid`;
  if (!row || row.closed) return { indexable: false, reason: "closed" };
  if (row.thin) return { indexable: false, reason: "thin" };
  if (row.representative && row.representative !== id) return { indexable: false, reason: "copy", canonicalId: row.representative };
  return { indexable: true };
}

// Every indexable offer, by id (the sitemaps), kept an hour.
const KEEP_MS = 3600 * 1000;
let cached: { at: number; ids: { id: string; updatedAt: Date }[] } | null = null;
let loading: Promise<{ id: string; updatedAt: Date }[]> | null = null;

export async function indexableOffers(): Promise<{ id: string; updatedAt: Date }[]> {
  if (cached && Date.now() - cached.at < KEEP_MS) return cached.ids;
  loading ??= prisma.$queryRaw<{ id: string; updated_at: Date }[]>`
      SELECT id, updated_at FROM (
        SELECT o.id, o.updated_at, row_number() OVER (PARTITION BY ${COMPANY_KEY}, ${TITLE_KEY}, o.location_id ORDER BY ${RANK}) AS position
        FROM offers o WHERE ${eligible()}
      ) ranked WHERE position = 1 ORDER BY id`
    .then((rows) => rows.map((row) => ({ id: row.id, updatedAt: row.updated_at })))
    .finally(() => {
      loading = null;
    });
  const ids = await loading;
  cached = { at: Date.now(), ids };
  return ids;
}

// The indexable ones among these offers (the engines' notifications).
export async function indexableAmong(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM (
      SELECT o.id, row_number() OVER (PARTITION BY ${COMPANY_KEY}, ${TITLE_KEY}, o.location_id ORDER BY ${RANK}) AS position
      FROM offers o
      WHERE ${eligible()} AND EXISTS (
        SELECT 1 FROM offers n WHERE n.id = ANY(${ids}::uuid[])
          AND coalesce(n.company_id::text, lower(n.company_name)) = ${COMPANY_KEY}
          AND lower(regexp_replace(n.title, '\\s+', ' ', 'g')) = ${TITLE_KEY}
          AND n.location_id IS NOT DISTINCT FROM o.location_id)
    ) ranked WHERE position = 1 AND id = ANY(${ids}::uuid[])`;
  return new Set(rows.map((row) => row.id));
}

// Tests.
export function resetIndexableOffers(): void {
  cached = null;
}
