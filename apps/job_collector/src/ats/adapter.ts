import { createHash } from "node:crypto";
import { collectorConfig } from "../config";
import type { CollectedRecord, ConnectorKind } from "../connectors/types";

// One adapter per recruiting tool (COLLECTOR.md §5.2).

export type BoardCheck = { companyName: string | null; jobCount: number; franceJobCount: number };

// The board's offers already collected: external id → release date stored with them.
export type KnownOffers = Map<string, string | null>;
// An offer still listed whose details weren't fetched again (same release date).
export type StillListed = { stillListed: string };

// Known offers are fetched again once every `detailRefreshDays` (on a day picked from
// their id, so the refreshes are spread), to catch edits that keep the release date.
export function refreshDue(externalId: string, now = new Date()): boolean {
  const days = collectorConfig.ats.detailRefreshDays;
  const day = Math.floor(now.getTime() / (24 * 3600 * 1000));
  return createHash("sha1").update(externalId).digest().readUInt32BE(0) % days === day % days;
}

export interface AtsAdapter {
  ats: string; // = company_sources.ats = connector key = offer_sources.source
  kind?: ConnectorKind; // "ats" by default; the career-site crawler is a "crawler"
  schedule?: string; // cron; the ATS schedule by default
  // Discovery: URL prefixes of the tool's public job pages, and the board id in a URL
  // (career sites are found otherwise).
  // matchType "domain" reads every host of a domain ("*.recruitee.com").
  discovery?: { prefixes: string[]; matchType?: "prefix" | "domain"; slugFromUrl(url: URL): string | null };
  // Throws NotFoundError when the board doesn't exist (any more).
  check(slug: string): Promise<BoardCheck>;
  // The board's offers located in France, mapped to the ingestion contract. Tools that need
  // a request per offer may skip the known ones (`known`) and yield them as still listed.
  collect(slug: string, companyName: string, known?: KnownOffers): AsyncGenerator<CollectedRecord | StillListed>;
}

// Path segments that are pages of the tool, not company boards.
const NOT_A_BOARD = new Set(["", "embed", "api", "v1", "oauth", "static", "assets", "favicon.ico", "robots.txt", "sitemap.xml", "js", "css", "images", "_next", "job_app", "jobs", "search", "login", "signin"]);

export function firstPathSegment(url: URL): string | null {
  const segment = decodeURIComponent(url.pathname.split("/")[1] ?? "").trim();
  if (NOT_A_BOARD.has(segment.toLowerCase()) || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(segment)) return null;
  return segment;
}
