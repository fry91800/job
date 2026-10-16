import { prisma } from "@job/backend";
import type { AtsAdapter } from "../ats/adapter";
import { collectorConfig } from "../config";
import { capturesFor, surtPrefixes, type Capture } from "./cc-index";

// Company discovery (COLLECTOR.md §5.2): Common Crawl's URL index lists the public job
// pages it crawled; the board id in each URL gives a candidate board. The index is read
// from its files (cc-index.ts), over the last few crawls: boards come and go between
// crawls, and each crawl only sees part of the web. Candidates with French-language pages
// are marked (":fr") and checked first.

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { "User-Agent": "MonPosteBot/0.1 (company discovery)" }, signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return (await response.json()) as T;
}

// The most recent crawl ids, newest first.
export async function recentCrawls(count: number): Promise<string[]> {
  const crawls = await fetchJson<{ id: string }[]>(`${collectorConfig.discovery.commonCrawlIndex}/collinfo.json`);
  return crawls.slice(0, count).map((crawl) => crawl.id);
}

export async function latestCrawl(): Promise<string> {
  return (await recentCrawls(1))[0];
}

// Board ids found in captures, and whether each has a French-language page.
export function boardsFromCaptures(adapter: AtsAdapter, captures: Pick<Capture, "url" | "languages">[]): Map<string, { french: boolean }> {
  const boards = new Map<string, { french: boolean }>();
  for (const capture of captures) {
    let slug: string | null = null;
    try {
      slug = adapter.discovery?.slugFromUrl(new URL(capture.url)) ?? null;
    } catch {
      // Not a URL: ignored.
    }
    if (!slug) continue;
    const french = (capture.languages ?? "").split(",").includes("fra");
    boards.set(slug, { french: french || (boards.get(slug)?.french ?? false) });
  }
  return boards;
}

// Candidates are saved after each crawl; a crawl that keeps failing is logged and skipped,
// the others still count.
export async function discoverBoards(
  adapter: AtsAdapter,
  options: { crawls?: string[]; log?: (message: string) => void } = {},
): Promise<{ found: number; added: number; french: number; failedCrawls: string[] }> {
  const log = options.log ?? ((message: string) => console.log(`[discover:${adapter.ats}] ${message}`));
  const crawls = options.crawls ?? (await recentCrawls(collectorConfig.discovery.crawls));
  const prefixes = (adapter.discovery?.prefixes ?? []).flatMap((prefix) =>
    prefix.startsWith("*.") ? surtPrefixes(prefix.slice(2), "domain") : surtPrefixes(prefix, "prefix"),
  );
  const all = new Map<string, { french: boolean }>();
  const failedCrawls: string[] = [];
  let added = 0;

  for (const crawl of crawls) {
    let boards: Map<string, { french: boolean }>;
    try {
      boards = boardsFromCaptures(adapter, await capturesFor(crawl, prefixes, (message) => log(`${crawl} ${message}`)));
    } catch (error) {
      failedCrawls.push(crawl);
      log(`${crawl}: stopped (${error instanceof Error ? error.message : error})`);
      continue;
    }
    // Board ids found in another letter case ("AbbVie" / "abbvie") are the same board.
    const known = new Set(
      (await prisma.companySource.findMany({ where: { ats: adapter.ats }, select: { slug: true } })).map((row) => row.slug.toLowerCase()),
    );
    const fresh = new Map<string, { slug: string; french: boolean }>();
    for (const [slug, { french }] of boards) {
      const key = slug.toLowerCase();
      if (!known.has(key)) fresh.set(key, { slug, french: french || (fresh.get(key)?.french ?? false) });
    }
    const { count } = await prisma.companySource.createMany({
      data: [...fresh.values()].map(({ slug, french }) => ({ ats: adapter.ats, slug, status: "candidate", discoveredFrom: `commoncrawl:${crawl}${french ? ":fr" : ""}` })),
      skipDuplicates: true,
    });
    added += count;
    for (const [slug, info] of boards) all.set(slug, { french: info.french || (all.get(slug)?.french ?? false) });
    log(`${crawl}: ${boards.size} board(s), ${count} new candidate(s)`);
  }

  const french = [...all.values()].filter((board) => board.french).length;
  log(`${all.size} board(s) found (${french} with French pages), ${added} new candidate(s)${failedCrawls.length ? `, failed: ${failedCrawls.join(", ")}` : ""}`);
  return { found: all.size, added, french, failedCrawls };
}
