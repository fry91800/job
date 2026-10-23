import { createSign } from "node:crypto";
import { errorFields, logEvent, sendAlert } from "@job/backend";
import { config } from "../config";
import { prisma } from "../lib/prisma";

// Search engines told at once about new and closed offer pages (SEO.md), instead of waiting
// for them to crawl the sitemaps:
// * Google's Indexing API, meant for pages with JobPosting: URL_UPDATED for a new offer,
//   URL_DELETED for a closed one; a daily quota (200 by default), so the newest offers go
//   first and a quarter of the quota is kept for closed ones; what doesn't fit is left to the
//   sitemaps;
// * IndexNow (Bing, Yandex, Seznam, Naver…): every new or closed offer page, up to 10 000
//   addresses a request, proven ours by the key file /indexnow/{key}.txt.
// Each engine keeps a cursor (search_indexing): offers opened or closed after it are told on
// the next run; a failed run leaves the cursor, so the next one tries again.

export const endpoints = {
  googleToken: "https://oauth2.googleapis.com/token",
  googlePublish: "https://indexing.googleapis.com/v3/urlNotifications:publish",
  indexNow: "https://api.indexnow.org/indexnow",
};

const FIRST_LOOK_BACK_MS = 24 * 3600 * 1000; // a first run tells the last day's changes only
const INDEXNOW_BATCH = 10_000;

type Change = { url: string; type: "URL_UPDATED" | "URL_DELETED"; at: Date };

const offerUrl = (id: string) => `${config.webBaseUrl}/offers/${id}`;

// Public offers opened or closed in (since, until]; `jobPostingOnly`: offers whose page carries
// JobPosting (a company, and a place or fully remote), as Google's API asks.
async function changes(since: Date, until: Date, jobPostingOnly: boolean): Promise<{ opened: Change[]; closed: Change[] }> {
  const eligible = jobPostingOnly ? { OR: [{ companyId: { not: null } }, { companyName: { not: null } }], AND: [{ OR: [{ locationId: { not: null } }, { remoteType: "remote" as const }] }] } : {};
  const [opened, closed] = await Promise.all([
    prisma.offer.findMany({ where: { isPublic: true, closedAt: null, createdAt: { gt: since, lte: until }, ...eligible }, select: { id: true, createdAt: true }, orderBy: { createdAt: "desc" } }),
    prisma.offer.findMany({ where: { isPublic: true, closedAt: { gt: since, lte: until }, ...eligible }, select: { id: true, closedAt: true }, orderBy: { closedAt: "desc" } }),
  ]);
  return {
    opened: opened.map((offer) => ({ url: offerUrl(offer.id), type: "URL_UPDATED", at: offer.createdAt })),
    closed: closed.map((offer) => ({ url: offerUrl(offer.id), type: "URL_DELETED", at: offer.closedAt! })),
  };
}

async function cursor(engine: string, now: Date) {
  const row = await prisma.searchIndexing.findUnique({ where: { engine } });
  return row ?? { engine, cursorAt: new Date(now.getTime() - FIRST_LOOK_BACK_MS), day: "", sentToday: 0 };
}

const saveCursor = (engine: string, data: { cursorAt: Date; day: string; sentToday: number }) =>
  prisma.searchIndexing.upsert({ where: { engine }, create: { engine, ...data }, update: data });

// --- IndexNow ---------------------------------------------------------------------------------

export async function notifyIndexNow(now = new Date()): Promise<{ sent: number } | null> {
  const key = config.seo.indexing.indexNowKey;
  if (!key) return null;
  const state = await cursor("indexnow", now);
  const { opened, closed } = await changes(state.cursorAt, now, false);
  const urls = [...opened, ...closed].map((change) => change.url);
  const host = new URL(config.webBaseUrl).host;
  for (let start = 0; start < urls.length; start += INDEXNOW_BATCH) {
    const response = await fetch(endpoints.indexNow, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ host, key, keyLocation: `${config.webBaseUrl}/indexnow/${key}.txt`, urlList: urls.slice(start, start + INDEXNOW_BATCH) }),
      signal: AbortSignal.timeout(30_000),
    });
    // 200: received; 202: received, key check pending.
    if (response.status !== 200 && response.status !== 202) throw new Error(`IndexNow answered HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }
  await saveCursor("indexnow", { cursorAt: now, day: state.day, sentToday: state.sentToday });
  return { sent: urls.length };
}

// --- Google's Indexing API ----------------------------------------------------------------------

type ServiceAccount = { client_email: string; private_key: string };

function serviceAccount(): ServiceAccount | null {
  const encoded = config.seo.indexing.googleCredentials;
  if (!encoded) return null;
  const account = JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as Partial<ServiceAccount>;
  if (!account.client_email || !account.private_key) throw new Error("GOOGLE_INDEXING_CREDENTIALS_BASE64: not a service account key (client_email, private_key)");
  return account as ServiceAccount;
}

// An access token for the Indexing API: a JWT signed with the service account's key,
// exchanged at Google's token endpoint.
async function googleAccessToken(account: ServiceAccount, now: Date): Promise<string> {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const issuedAt = Math.floor(now.getTime() / 1000);
  const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ iss: account.client_email, scope: "https://www.googleapis.com/auth/indexing", aud: endpoints.googleToken, iat: issuedAt, exp: issuedAt + 3600 })}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(account.private_key, "base64url");
  const response = await fetch(endpoints.googleToken, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` }),
    signal: AbortSignal.timeout(30_000),
  });
  const answer = (await response.json().catch(() => ({}))) as { access_token?: string; error?: string; error_description?: string };
  if (!response.ok || !answer.access_token) throw new Error(`Google token: HTTP ${response.status} ${answer.error ?? ""} ${answer.error_description ?? ""}`.trim());
  return answer.access_token;
}

// Google's quota resets at midnight Pacific time.
const quotaDay = (now: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(now);

// The changes that fit today's quota: the newest first, a quarter kept for closed offers.
export function withinQuota(opened: Change[], closed: Change[], left: number): Change[] {
  if (left <= 0) return [];
  const closedShare = Math.min(closed.length, Math.max(Math.floor(left / 4), left - opened.length));
  return [...opened.slice(0, left - closedShare), ...closed.slice(0, closedShare)];
}

export async function notifyGoogle(now = new Date()): Promise<{ sent: number; skipped: number } | null> {
  const account = serviceAccount();
  if (!account) return null;
  const state = await cursor("google", now);
  const day = quotaDay(now);
  let sentToday = state.day === day ? state.sentToday : 0;
  const { opened, closed } = await changes(state.cursorAt, now, true);
  const chosen = withinQuota(opened, closed, config.seo.indexing.dailyQuota - sentToday);
  let sent = 0;
  if (chosen.length) {
    const token = await googleAccessToken(account, now);
    for (const change of chosen) {
      const response = await fetch(endpoints.googlePublish, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ url: change.url, type: change.type }),
        signal: AbortSignal.timeout(30_000),
      });
      // Quota used up (ours was too optimistic): nothing more today.
      if (response.status === 429) {
        sentToday = config.seo.indexing.dailyQuota;
        break;
      }
      if (!response.ok) throw new Error(`Google Indexing API answered HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
      sent++;
      sentToday++;
    }
  }
  // What didn't fit is left to the sitemaps: the cursor moves on.
  await saveCursor("google", { cursorAt: now, day, sentToday });
  return { sent, skipped: opened.length + closed.length - sent };
}

// --- Schedule ---------------------------------------------------------------------------------

export async function runSearchIndexing(now = new Date()) {
  const result: Record<string, unknown> = {};
  for (const [engine, notify] of [["indexnow", notifyIndexNow], ["google", notifyGoogle]] as const) {
    try {
      const outcome = await notify(now);
      if (outcome) result[engine] = outcome;
    } catch (error) {
      result[engine] = "failed";
      logEvent("error", "search_indexing_failed", { engine, ...errorFields(error) });
      void sendAlert(`search-indexing-${engine}`, `Search engine notifications (${engine}) failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return result;
}

export function scheduleSearchIndexing(): (() => void) | undefined {
  const { checkMinutes, googleCredentials, indexNowKey } = config.seo.indexing;
  if (checkMinutes <= 0 || (!googleCredentials && !indexNowKey)) return undefined;
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const result = await runSearchIndexing();
      if (Object.keys(result).length) logEvent("info", "search_indexing_done", result);
    } finally {
      running = false;
    }
  };
  const first = setTimeout(run, 90 * 1000);
  const every = setInterval(run, checkMinutes * 60 * 1000);
  first.unref();
  every.unref();
  return () => {
    clearTimeout(first);
    clearInterval(every);
  };
}
