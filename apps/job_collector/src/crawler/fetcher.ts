import { safeFetch, SafeFetchError, type SafeFetchResponse } from "@job/backend";
import { pause } from "../ats/http";
import { collectorConfig } from "../config";
import { ALLOW_ALL, DISALLOW_ALL, parseRobots, type Robots } from "./robots";

// Polite fetching of career sites (COLLECTOR.md §5.3): robots.txt obeyed, one request at a
// time per host with a pause between them (the larger of ours and the site's crawl-delay),
// through the shared safe fetcher (public addresses only, limits on size and time).

export class CrawlError extends Error {}
// The page is gone (404/410): an offer that disappeared, or a site that no longer exists.
export class PageGoneError extends CrawlError {}
// robots.txt forbids it.
export class DisallowedError extends CrawlError {}
// The host doesn't exist (DNS): a career site that is gone.
export class UnknownHostError extends PageGoneError {}

// robots.txt by host; `failure` when it couldn't be read (nothing is fetched meanwhile).
const robotsCache = new Map<string, { robots: Robots; at: number; failure?: CrawlError }>();
const nextRequestAt = new Map<string, number>();
const hostQueues = new Map<string, Promise<unknown>>();

const options = () => {
  const crawler = collectorConfig.crawler;
  return {
    userAgent: crawler.userAgent,
    timeoutMs: crawler.timeoutMs,
    maxBytes: crawler.maxBytes,
    maxRedirects: crawler.maxRedirects,
    allowedPrivateAddresses: crawler.allowedPrivateAddresses,
    accept: "text/html,application/xhtml+xml,application/xml,text/xml;q=0.9,text/plain;q=0.8",
    contentTypes: /text\/html|application\/xhtml\+xml|xml|text\/plain|application\/(x-)?gzip|application\/octet-stream/i,
  };
};

// Requests to one host run one after the other, spaced by its delay.
function onHost<T>(host: string, delayMs: number, task: () => Promise<T>): Promise<T> {
  const previous = hostQueues.get(host) ?? Promise.resolve();
  const run = previous.catch(() => {}).then(async () => {
    const wait = (nextRequestAt.get(host) ?? 0) - Date.now();
    if (wait > 0) await pause(wait);
    try {
      return await task();
    } finally {
      nextRequestAt.set(host, Date.now() + delayMs);
    }
  });
  hostQueues.set(host, run);
  return run;
}

async function rawGet(url: URL, delayMs: number): Promise<SafeFetchResponse> {
  return onHost(url.host, delayMs, async () => {
    try {
      return await safeFetch(url.toString(), options());
    } catch (error) {
      if (error instanceof SafeFetchError && error.reason === "unknown_host") throw new UnknownHostError(`${url}: ${error.message}`);
      if (error instanceof SafeFetchError) throw new CrawlError(`${url}: ${error.message}`);
      throw error;
    }
  });
}

// robots.txt of a host. Missing (4xx): everything allowed. Server error: nothing allowed
// for now (RFC 9309). Unreachable: the error is thrown, and again for the next requests
// until the cache expires.
export async function robotsFor(origin: URL): Promise<Robots> {
  const cached = robotsCache.get(origin.host);
  if (cached && Date.now() - cached.at < collectorConfig.crawler.robotsTtlMs) {
    if (cached.failure) throw cached.failure;
    return cached.robots;
  }
  try {
    const response = await rawGet(new URL("/robots.txt", origin), collectorConfig.crawler.minDelayMs);
    const robots =
      response.status >= 200 && response.status < 300 ? parseRobots(response.text, collectorConfig.crawler.agent) : response.status < 500 ? ALLOW_ALL : DISALLOW_ALL;
    robotsCache.set(origin.host, { robots, at: Date.now() });
    return robots;
  } catch (error) {
    if (!(error instanceof CrawlError)) throw error;
    robotsCache.set(origin.host, { robots: DISALLOW_ALL, at: Date.now(), failure: error });
    throw error;
  }
}

// robots.txt rules, unless the configuration says to ignore them (crawler.respectRobotsTxt).
export function allowedByRobots(robots: Robots, url: URL): boolean {
  return !collectorConfig.crawler.respectRobotsTxt || robots.allows(url.pathname + url.search);
}

export function delayFor(robots: Robots): number {
  const { minDelayMs, maxDelayMs } = collectorConfig.crawler;
  return Math.min(Math.max(minDelayMs, robots.crawlDelayMs ?? 0), maxDelayMs);
}

// A page of a career site, if robots.txt allows it. 404/410 → PageGoneError; other
// failures → CrawlError.
export async function crawlGet(input: string): Promise<{ url: string; text: string; contentType: string }> {
  const url = new URL(input);
  const robots = await robotsFor(url);
  if (!allowedByRobots(robots, url)) throw new DisallowedError(`${url}: disallowed by robots.txt`);
  const response = await rawGet(url, delayFor(robots));
  if (response.status === 404 || response.status === 410) throw new PageGoneError(`${url}: HTTP ${response.status}`);
  if (response.status < 200 || response.status >= 300) throw new CrawlError(`${url}: HTTP ${response.status}`);
  return { url: response.url, text: response.text, contentType: response.contentType };
}

// A site's own JSON feed, by POST (Workday's job list), under the same rules as its pages:
// robots.txt, one request at a time per host, spaced.
export async function crawlPostJson<T>(input: string, body: unknown): Promise<T> {
  const url = new URL(input);
  const robots = await robotsFor(url);
  if (!allowedByRobots(robots, url)) throw new DisallowedError(`${url}: disallowed by robots.txt`);
  const response = await onHost(url.host, delayFor(robots), async () => {
    try {
      return await safeFetch(url.toString(), {
        ...options(),
        accept: "application/json",
        contentTypes: /json/i,
        post: { body: JSON.stringify(body), contentType: "application/json" },
      });
    } catch (error) {
      if (error instanceof SafeFetchError && error.reason === "unknown_host") throw new UnknownHostError(`${url}: ${error.message}`);
      if (error instanceof SafeFetchError) throw new CrawlError(`${url}: ${error.message}`);
      throw error;
    }
  });
  if (response.status === 404 || response.status === 410) throw new PageGoneError(`${url}: HTTP ${response.status}`);
  if (response.status < 200 || response.status >= 300) throw new CrawlError(`${url}: HTTP ${response.status}`);
  try {
    return JSON.parse(response.text) as T;
  } catch {
    throw new CrawlError(`${url}: not JSON`);
  }
}

// Tests: forget robots.txt files and pauses.
export function resetCrawler(): void {
  robotsCache.clear();
  nextRequestAt.clear();
  hostQueues.clear();
}
