import { prisma } from "@job/backend";

// Coverage and quality metrics (COLLECTOR.md §9), from the database. Coverage of the
// evaluation slice is measured by hand against the job boards and is not computed here.

export async function collectorMetrics() {
  const [volume, completeness, duplicates, freshness, runs] = await Promise.all([
    prisma.$queryRaw<{ source: string; open: number; new_24h: number }[]>`
      SELECT s.source, count(*) FILTER (WHERE s.closed_at IS NULL)::int AS open,
             count(*) FILTER (WHERE s.first_seen_at > now() - interval '24 hours')::int AS new_24h
      FROM offer_sources s GROUP BY s.source ORDER BY open DESC`,
    prisma.$queryRaw<{ offers: number; with_salary: number; with_location: number; with_contract: number; with_3_skills: number; long_description: number; avg_quality: number }[]>`
      SELECT count(*)::int AS offers,
             count(*) FILTER (WHERE o.salary_min IS NOT NULL OR o.salary_max IS NOT NULL)::int AS with_salary,
             count(*) FILTER (WHERE o.location_id IS NOT NULL)::int AS with_location,
             count(*) FILTER (WHERE o.contract_type IS NOT NULL)::int AS with_contract,
             count(*) FILTER (WHERE (SELECT count(*) FROM offer_skills k WHERE k.offer_id = o.id) >= 3)::int AS with_3_skills,
             count(*) FILTER (WHERE length(o.description) > 500)::int AS long_description,
             coalesce(round(avg(o.quality_score)), 0)::int AS avg_quality
      FROM offers o WHERE o.closed_at IS NULL AND EXISTS (SELECT 1 FROM offer_sources s WHERE s.offer_id = o.id)`,
    prisma.$queryRaw<{ multi_source: number }[]>`
      SELECT count(*)::int AS multi_source FROM (SELECT offer_id FROM offer_sources GROUP BY offer_id HAVING count(*) > 1) t`,
    prisma.$queryRaw<{ median_hours: number | null; verified_7d: number }[]>`
      SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (s.first_seen_at - o.published_at)) / 3600))::int AS median_hours,
             count(*) FILTER (WHERE o.last_verified_at > now() - interval '7 days')::int AS verified_7d
      FROM offers o JOIN offer_sources s ON s.offer_id = o.id
      WHERE o.closed_at IS NULL AND o.published_at IS NOT NULL`,
    prisma.$queryRaw<{ connector: string; status: string; started_at: Date; counts: unknown }[]>`
      SELECT DISTINCT ON (connector) connector, status, started_at, counts FROM collector_runs ORDER BY connector, started_at DESC`,
  ]);
  return { volume, completeness: completeness[0], duplicates: duplicates[0], freshness: freshness[0], lastRuns: runs };
}
