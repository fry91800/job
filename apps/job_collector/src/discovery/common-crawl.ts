import { prisma } from "@job/backend";
import type { AtsAdapter } from "../ats/adapter";
import { pause } from "../ats/http";
import { collectorConfig } from "../config";

// Company discovery (COLLECTOR.md §5.2): Common Crawl's URL index lists the public job
// pages it crawled; the board id in each URL gives a candidate board. Read page by page
// with pauses (the index is a shared public service, often busy), retried on failure.

async function fetchText(url: string): Promise<string> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": "JobPlatformBot/0.1 (company discovery)" },
        signal: AbortSignal.timeout(120_000),
      });
      if (response.ok) return response.text();
      if (response.status === 404) return "";
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await pause(5000 * attempt);
  }
  throw lastError;
}

export async function latestCrawl(): Promise<string> {
  const crawls = JSON.parse(await fetchText(`${collectorConfig.discovery.commonCrawlIndex}/collinfo.json`)) as { id: string }[];
  return crawls[0].id;
}

// Board ids found in a list of index lines (JSON with a "url" field).
export function slugsFromIndexLines(adapter: AtsAdapter, text: string): Set<string> {
  const slugs = new Set<string>();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const slug = adapter.discovery.slugFromUrl(new URL(JSON.parse(line).url));
      if (slug) slugs.add(slug);
    } catch {
      // Not a JSON line or not a URL: ignored.
    }
  }
  return slugs;
}

// Candidates are saved after each URL prefix; a prefix that keeps failing (the index is
// often busy) is logged and skipped, the others still count.
export async function discoverBoards(
  adapter: AtsAdapter,
  options: { crawl?: string; maxPages?: number; log?: (message: string) => void } = {},
): Promise<{ found: number; added: number; failedPrefixes: string[] }> {
  const log = options.log ?? ((message: string) => console.log(`[discover:${adapter.ats}] ${message}`));
  const crawl = options.crawl ?? (await latestCrawl());
  const endpoint = `${collectorConfig.discovery.commonCrawlIndex}/${crawl}-index`;
  const all = new Set<string>();
  const failedPrefixes: string[] = [];
  let added = 0;

  for (const prefix of adapter.discovery.prefixes) {
    const slugs = new Set<string>();
    try {
      const query = `url=${encodeURIComponent(prefix)}&matchType=prefix&pageSize=1`;
      const { pages } = JSON.parse((await fetchText(`${endpoint}?${query}&showNumPages=true`)) || '{"pages":0}') as { pages: number };
      const last = Math.min(pages, options.maxPages ?? pages);
      for (let page = 0; page < last; page++) {
        const text = await fetchText(`${endpoint}?${query}&output=json&fl=url&page=${page}`);
        for (const slug of slugsFromIndexLines(adapter, text)) slugs.add(slug);
        log(`${prefix} page ${page + 1}/${last}: ${slugs.size} board(s)`);
        await pause(collectorConfig.discovery.pauseBetweenPagesMs);
      }
    } catch (error) {
      failedPrefixes.push(prefix);
      log(`${prefix}: stopped (${error instanceof Error ? error.message : error}), keeping the ${slugs.size} board(s) found`);
    }
    // Board ids found in another letter case ("AbbVie" / "abbvie") are the same board.
    const known = new Set(
      (await prisma.companySource.findMany({ where: { ats: adapter.ats }, select: { slug: true } })).map((row) => row.slug.toLowerCase()),
    );
    const fresh = new Map<string, string>();
    for (const slug of slugs) if (!known.has(slug.toLowerCase()) && !fresh.has(slug.toLowerCase())) fresh.set(slug.toLowerCase(), slug);
    const { count } = await prisma.companySource.createMany({
      data: [...fresh.values()].map((slug) => ({ ats: adapter.ats, slug, status: "candidate", discoveredFrom: `commoncrawl:${crawl}` })),
      skipDuplicates: true,
    });
    added += count;
    slugs.forEach((slug) => all.add(slug));
  }

  log(`${all.size} board(s) found, ${added} new candidate(s)${failedPrefixes.length ? `, failed: ${failedPrefixes.join(", ")}` : ""}`);
  return { found: all.size, added, failedPrefixes };
}
