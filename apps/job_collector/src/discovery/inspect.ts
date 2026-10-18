import { readFile, writeFile } from "node:fs/promises";
import { prisma } from "@job/backend";
import { atsAdapters } from "../ats/registry";
import { careerSiteFromUrl } from "../crawler/career-site";
import { CrawlError, crawlGet, DisallowedError } from "../crawler/fetcher";
import { extractJobPostings } from "../crawler/job-posting";

// `npm run collector -- inspect <address…> [--file list.txt] [--json out.json]`: what a
// company's career site runs on, to decide how to collect it (COLLECTOR.md §17.11). From
// the address (a home page is enough), it follows a few links towards the job pages and
// looks for: boards of the tools we support (by each adapter's own address rules), known
// tools we don't support yet, and schema.org JobPosting on an offer page. At most
// MAX_PAGES pages per site, through the polite fetcher (robots.txt, spacing per host).

const MAX_PAGES = 6;

// Recruiting tools not supported yet, by a mark in a page's addresses or code.
const UNSUPPORTED: { name: string; pattern: RegExp }[] = [
  // Career Site Builder sites are supported (j2w.init on the page); other SuccessFactors pages aren't.
  { name: "successfactors", pattern: /successfactors\.(com|eu)|jobs\.sap\.com|career\d*\.sapsf|rmk-map|sfcareer|j2w\./i },
  { name: "taleo", pattern: /taleo\.net/i },
  { name: "oracle-cloud", pattern: /oraclecloud\.com\/hcmUI\/CandidateExperience|fa-[a-z0-9]+-saasfaprod/i },
  { name: "phenom", pattern: /cdn\.phenompeople\.com|phenompeople|"phApp"|ph-page-|phenom-/i },
  { name: "avature", pattern: /avature\.net|avature\.com/i },
  { name: "icims", pattern: /icims\.com/i },
  { name: "eightfold", pattern: /eightfold\.ai/i },
  { name: "radancy", pattern: /radancy|tmpworldwide|clientfiles\.tmp/i },
  { name: "cornerstone", pattern: /csod\.com|cornerstoneondemand/i },
  { name: "beetween", pattern: /beetween\.com/i },
  { name: "jobaffinity", pattern: /jobaffinity\.fr/i },
  { name: "digitalrecruiters", pattern: /digitalrecruiters\.com/i },
  { name: "flatchr", pattern: /flatchr\.io/i },
  { name: "taleez", pattern: /taleez\.com/i },
  { name: "softy", pattern: /softy\.pro/i },
  { name: "gestmax", pattern: /gestmax\.fr/i },
  { name: "talentlink", pattern: /talentlink\.com|lumessetalentlink/i },
  { name: "jobteaser", pattern: /jobteaser\.com/i },
  { name: "breezy", pattern: /breezy\.hr/i },
  { name: "bamboohr", pattern: /bamboohr\.com/i },
  { name: "jobvite", pattern: /jobvite\.com/i },
  { name: "umantis", pattern: /umantis\.com/i },
  { name: "welcome-to-the-jungle", pattern: /welcometothejungle\.com\/[a-z]{2}\/companies\//i },
];

// Links that lead towards job pages, and links that look like one offer.
const CAREER_LINK = /carri[eè]re|career|recrut|emploi|jobs?\b|offres?|nous-rejoindre|rejoignez|join-?us|talent|postuler|opportunit/i;
const OFFER_LINK = /(job|offre|emploi|poste|vacanc|position|requisition)[^?#]*[/_=-][a-z0-9-]*\d{3,}/i;

export type Inspection = {
  input: string;
  url: string | null; // the career page reached
  pages: number;
  status: "ok" | "blocked" | "unreachable" | "robots";
  supported: { ats: string; slug: string; registry: string | null }[]; // registry: the board's status, or null if not in it
  unsupported: string[];
  jobPosting: boolean | null; // null: no offer page found to check
  verdict: string;
  error?: string;
};

function addresses(html: string, base: string): URL[] {
  const found: URL[] = [];
  for (const match of html.matchAll(/(?:href|src|action|data-url)\s*=\s*["']([^"'#][^"']*)["']/gi)) {
    try {
      found.push(new URL(match[1].replace(/&amp;/g, "&"), base));
    } catch {
      // Not an address.
    }
  }
  // Addresses written in scripts and JSON ("https:\/\/x.myworkdayjobs.com\/…").
  for (const match of html.replace(/\\\//g, "/").matchAll(/https?:\/\/[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s"'<>\\)]*)?/gi)) {
    try {
      found.push(new URL(match[0]));
    } catch {
      // Not an address.
    }
  }
  return found;
}

function supportedBoards(urls: URL[]): { ats: string; slug: string }[] {
  const boards = new Map<string, { ats: string; slug: string }>();
  for (const url of urls) {
    const site = careerSiteFromUrl(url);
    if (site) boards.set(`careersite/${site}`, { ats: "careersite", slug: site });
    const host = url.hostname.toLowerCase();
    const hostPath = `${host}${url.pathname}`;
    for (const adapter of atsAdapters) {
      const prefixes = adapter.discovery?.prefixes ?? [];
      const matches = prefixes.some((prefix) => (prefix.startsWith("*.") ? host.endsWith(prefix.slice(1)) : hostPath.startsWith(prefix)));
      if (!matches) continue;
      const slug = adapter.discovery!.slugFromUrl(url);
      if (slug) boards.set(`${adapter.ats}/${slug}`, { ats: adapter.ats, slug });
    }
  }
  return [...boards.values()];
}

const sameSite = (a: URL, b: URL) => a.hostname.replace(/^www\./, "").split(".").slice(-2).join(".") === b.hostname.replace(/^www\./, "").split(".").slice(-2).join(".");

export async function inspectSite(input: string): Promise<Inspection> {
  const result: Inspection = { input, url: null, pages: 0, status: "ok", supported: [], unsupported: [], jobPosting: null, verdict: "" };
  const start = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  const queue: string[] = [start];
  const seen = new Set<string>();
  const unsupported = new Set<string>();
  const successFactorsHosts = new Set<string>();
  const urls: URL[] = [];
  let offerPage: string | null = null;

  while (queue.length && result.pages < MAX_PAGES) {
    const next = queue.shift()!;
    if (seen.has(next)) continue;
    seen.add(next);
    let page: { url: string; text: string };
    try {
      page = await crawlGet(next);
    } catch (error) {
      if (result.pages === 0) {
        if (!result.error) {
          result.status = error instanceof DisallowedError ? "robots" : /HTTP (401|403|429)/.test(String(error)) ? "blocked" : "unreachable";
          result.error = error instanceof Error ? error.message : String(error);
        }
      }
      // The home page without "www." (or with it) when the first try fails.
      if (result.pages === 0 && next === start) {
        const other = new URL(start);
        other.hostname = other.hostname.startsWith("www.") ? other.hostname.slice(4) : `www.${other.hostname}`;
        if (!seen.has(other.toString())) {
          queue.unshift(other.toString());
          continue;
        }
      }
      continue;
    }
    result.pages++;
    result.status = "ok";
    delete result.error;
    const here = new URL(page.url);
    result.url ??= page.url;
    // SuccessFactors career sites (Career Site Builder): its script on the employer's host.
    if (/j2w\.init\(/.test(page.text)) successFactorsHosts.add(here.host);
    for (const tool of UNSUPPORTED) if (tool.pattern.test(page.text)) unsupported.add(tool.name);
    if (extractJobPostings(page.text).length > 0) result.jobPosting = true;
    const found = addresses(page.text, page.url);
    urls.push(here, ...found);

    // Towards the job pages: career links on the same site first, then an offer page.
    for (const url of found) {
      if (!/^https?:$/.test(url.protocol) || !sameSite(url, here)) continue;
      const link = url.toString().replace(/#.*$/, "");
      if (seen.has(link) || queue.includes(link)) continue;
      if (!offerPage && OFFER_LINK.test(url.pathname + url.search)) offerPage = link;
      else if (CAREER_LINK.test(url.pathname) && queue.length < 4) queue.push(link);
    }
    if (offerPage && !seen.has(offerPage) && result.jobPosting === null) queue.unshift(offerPage);
  }

  if (offerPage && seen.has(offerPage) && result.jobPosting === null) result.jobPosting = false;
  const boards = [...supportedBoards(urls), ...[...successFactorsHosts].map((slug) => ({ ats: "successfactors", slug }))];
  if (successFactorsHosts.size) unsupported.delete("successfactors");
  const known = boards.length
    ? await prisma.companySource.findMany({ where: { OR: boards.map((board) => ({ ats: board.ats, slug: board.slug })) }, select: { ats: true, slug: true, status: true } })
    : [];
  result.supported = boards.map((board) => ({ ...board, registry: known.find((row) => row.ats === board.ats && row.slug === board.slug)?.status ?? null }));
  result.unsupported = [...unsupported];
  result.verdict = verdict(result);
  return result;
}

function verdict(result: Inspection): string {
  if (result.status !== "ok") return { blocked: "blocked (refuses our crawler)", unreachable: "unreachable", robots: "robots.txt forbids it", ok: "" }[result.status];
  const supported = result.supported.filter((board) => board.ats !== "careersite");
  if (supported.length) return `supported: ${supported.map((board) => `${board.ats}/${board.slug}${board.registry ? ` (${board.registry})` : " (new)"}`).join(", ")}`;
  if (result.jobPosting) return `JobPosting on its pages → careersite ${new URL(result.url!).host}`;
  if (result.unsupported.length) return `unsupported tool: ${result.unsupported.join(", ")}`;
  return result.jobPosting === false ? "custom site, no JobPosting" : "no job pages found (built in the browser?)";
}

// "Name: domain" or a bare address per line; blank lines and # comments ignored.
export async function readSiteList(file: string): Promise<{ name: string; address: string }[]> {
  return (await readFile(file, "utf8"))
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const match = /^(.*?):\s*(\S+)$/.exec(line);
      return match && !/^https?$/i.test(match[1]) ? { name: match[1].trim(), address: match[2] } : { name: line, address: line };
    });
}

export async function inspectSites(sites: { name: string; address: string }[], options: { json?: string; concurrency?: number } = {}) {
  const results: (Inspection & { name: string })[] = [];
  let next = 0;
  // A few sites at a time: each host still gets one request at a time, spaced.
  await Promise.all(
    Array.from({ length: options.concurrency ?? 4 }, async () => {
      while (next < sites.length) {
        const site = sites[next++];
        try {
          const inspection = await inspectSite(site.address);
          results.push({ name: site.name, ...inspection });
          const also = inspection.unsupported.length && !inspection.verdict.includes("unsupported") ? ` [also: ${inspection.unsupported.join(", ")}]` : "";
          console.log(`${site.name.padEnd(24)} ${inspection.verdict}${also}${inspection.error ? ` — ${inspection.error.slice(0, 120)}` : ""}`);
        } catch (error) {
          if (!(error instanceof CrawlError) && !(error instanceof Error)) throw error;
          results.push({ name: site.name, input: site.address, url: null, pages: 0, status: "unreachable", supported: [], unsupported: [], jobPosting: null, verdict: "error", error: error.message });
          console.log(`${site.name.padEnd(24)} error: ${error.message}`);
        }
      }
    }),
  );
  if (options.json) await writeFile(options.json, JSON.stringify(results, null, 2));
  return results;
}
