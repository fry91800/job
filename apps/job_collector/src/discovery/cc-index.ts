import { gunzipSync } from "node:zlib";
import { pause } from "../ats/http";
import { collectorConfig } from "../config";

// Common Crawl's URL index, read directly from its files (COLLECTOR.md §5.2) instead of its
// public query service, which is often overloaded. Per crawl the index is ~300 compressed
// files of lines "SURT timestamp {json}", sorted by SURT (the address with the host
// reversed: "boards.greenhouse.io/acme" → "io,greenhouse,boards)/acme"), in independent
// gzip blocks of ~3 000 lines. `cluster.idx` (~100 MB, sorted) gives the first SURT of
// each block and where it is: a binary search in it with HTTP range requests finds the
// blocks of an address prefix, and only those blocks (~270 KB each) are downloaded.

export type Capture = { url: string; status: string | null; languages: string | null };

type ClusterLine = { key: string; file: string; offset: number; length: number };

const indexBase = (crawl: string) => `${collectorConfig.discovery.commonCrawlData}/cc-index/collections/${crawl}/indexes`;

async function fetchRange(url: string, start: number, end: number): Promise<Buffer> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 6; attempt++) {
    let throttled = false;
    try {
      const response = await fetch(url, {
        headers: { Range: `bytes=${start}-${end}`, "User-Agent": "MonPosteBot/0.1 (company discovery)" },
        signal: AbortSignal.timeout(120_000),
      });
      if (response.status === 206 || response.status === 200) return Buffer.from(await response.arrayBuffer());
      if (response.status === 416) return Buffer.alloc(0); // past the end of the file
      // The file server answers 403, 429 or 503 when asked too often: wait longer.
      throttled = [403, 429, 503].includes(response.status);
      lastError = new Error(`HTTP ${response.status} for ${url}`);
    } catch (error) {
      lastError = error;
    }
    await pause(collectorConfig.discovery.retryPauseMs * attempt * (throttled ? 4 : 1));
  }
  throw lastError;
}

async function fileSize(url: string): Promise<number> {
  const response = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(60_000) });
  const size = Number(response.headers.get("content-length"));
  if (!response.ok || !Number.isFinite(size) || size <= 0) throw new Error(`No size for ${url} (HTTP ${response.status})`);
  return size;
}

// The SURT prefixes of an address prefix ("boards.greenhouse.io/") or a domain
// ("teamtailor.com": the domain itself and its subdomains). "www." is dropped, as in the index.
export function surtPrefixes(prefix: string, matchType: "prefix" | "domain"): string[] {
  const slash = prefix.indexOf("/");
  const host = (slash === -1 ? prefix : prefix.slice(0, slash)).toLowerCase().replace(/^www\./, "");
  const reversed = host.split(".").filter(Boolean).reverse().join(",");
  if (matchType === "domain") return [`${reversed})`, `${reversed},`];
  return [`${reversed})${slash === -1 ? "" : prefix.slice(slash).toLowerCase()}`];
}

const parseClusterLine = (line: string): ClusterLine | null => {
  const [keyAndTime, file, offset, length] = line.split("\t");
  if (!keyAndTime || !file || !offset || !length) return null;
  return { key: keyAndTime.split(" ")[0], file, offset: Number(offset), length: Number(length) };
};

// The first complete line in a chunk read from the middle of the file.
function firstFullLine(chunk: string, atStart: boolean): string | null {
  const start = atStart ? 0 : chunk.indexOf("\n") + 1;
  if (!atStart && start === 0) return null;
  const end = chunk.indexOf("\n", start);
  return end === -1 ? null : chunk.slice(start, end);
}

// The index blocks that may hold SURTs starting with `prefix`.
async function blocksFor(crawl: string, prefix: string, clusterSize: number): Promise<ClusterLine[]> {
  const url = `${indexBase(crawl)}/cluster.idx`;
  const chunk = collectorConfig.discovery.clusterChunkBytes;
  // Binary search: `lo` stays on a position whose next full line sorts before the prefix.
  let lo = 0;
  let hi = clusterSize;
  while (hi - lo > chunk) {
    const mid = Math.floor((lo + hi) / 2);
    const line = firstFullLine((await fetchRange(url, mid, mid + chunk - 1)).toString("latin1"), false);
    const parsed = line ? parseClusterLine(line) : null;
    if (parsed && parsed.key < prefix) lo = mid;
    else hi = mid;
  }
  // Read on from `lo`: the last block starting before the prefix may hold its first lines,
  // then every block starting with the prefix.
  const blocks: ClusterLine[] = [];
  let before: ClusterLine | null = null;
  let position = lo;
  let carry = "";
  let skipFirst = lo !== 0;
  for (;;) {
    const data = (await fetchRange(url, position, position + 4 * chunk - 1)).toString("latin1"); // one char per byte: positions stay exact
    if (!data) break;
    position += data.length;
    const lines = (carry + data).split("\n");
    carry = lines.pop() ?? "";
    for (const line of lines) {
      if (skipFirst) {
        skipFirst = false;
        continue;
      }
      const parsed = parseClusterLine(line);
      if (!parsed) continue;
      if (parsed.key < prefix) before = parsed;
      else if (parsed.key.startsWith(prefix)) blocks.push(parsed);
      else return before ? [before, ...blocks] : blocks;
    }
    if (position >= clusterSize) break;
  }
  return before ? [before, ...blocks] : blocks;
}

// Every capture of the crawl whose SURT starts with one of the prefixes.
export async function capturesFor(crawl: string, prefixes: string[], log: (message: string) => void = () => {}): Promise<Capture[]> {
  const clusterSize = await fileSize(`${indexBase(crawl)}/cluster.idx`);
  const captures: Capture[] = [];
  for (const prefix of prefixes) {
    const blocks = await blocksFor(crawl, prefix, clusterSize);
    let found = 0;
    for (const [index, block] of blocks.entries()) {
      const gz = await fetchRange(`${indexBase(crawl)}/${block.file}`, block.offset, block.offset + block.length - 1);
      for (const line of gunzipSync(gz).toString("utf8").split("\n")) {
        const space = line.indexOf(" ");
        if (space === -1 || !line.slice(0, space).startsWith(prefix)) continue;
        try {
          const json = JSON.parse(line.slice(line.indexOf("{"))) as { url?: string; status?: string; languages?: string };
          if (json.url) captures.push({ url: json.url, status: json.status ?? null, languages: json.languages ?? null });
          found++;
        } catch {
          // A damaged line: skipped.
        }
      }
      if ((index + 1) % 50 === 0) log(`${prefix}: ${index + 1}/${blocks.length} blocks, ${found} captures`);
      await pause(collectorConfig.discovery.pauseBetweenBlocksMs);
    }
    log(`${prefix}: ${blocks.length} block(s), ${found} capture(s)`);
  }
  return captures;
}
