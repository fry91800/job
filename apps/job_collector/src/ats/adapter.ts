import type { CollectedRecord } from "../connectors/types";

// One adapter per recruiting tool (COLLECTOR.md §5.2).

export type BoardCheck = { companyName: string | null; jobCount: number; franceJobCount: number };

export interface AtsAdapter {
  ats: string; // = company_sources.ats = connector key = offer_sources.source
  // Discovery: URL prefixes of the tool's public job pages, and the board id in a URL.
  discovery: { prefixes: string[]; slugFromUrl(url: URL): string | null };
  // Throws NotFoundError when the board doesn't exist (any more).
  check(slug: string): Promise<BoardCheck>;
  // The board's offers located in France, mapped to the ingestion contract.
  collect(slug: string, companyName: string): AsyncGenerator<CollectedRecord>;
}

// Path segments that are pages of the tool, not company boards.
const NOT_A_BOARD = new Set(["", "embed", "api", "v1", "oauth", "static", "assets", "favicon.ico", "robots.txt", "sitemap.xml", "js", "css", "images", "_next", "job_app", "jobs", "search", "login", "signin"]);

export function firstPathSegment(url: URL): string | null {
  const segment = decodeURIComponent(url.pathname.split("/")[1] ?? "").trim();
  if (NOT_A_BOARD.has(segment.toLowerCase()) || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(segment)) return null;
  return segment;
}
