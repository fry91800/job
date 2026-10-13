import type { CollectedRecord, Connector } from "../types";

// PLACEHOLDER — per-site crawler (COLLECTOR.md §5.7). Not built: per-site code breaks
// whenever the site changes, and most job boards forbid scraping. Before building one for
// a site: its terms and robots.txt allow it, and the value justifies the maintenance.
export const siteCrawlerPlaceholder: Connector = {
  key: "site-crawler",
  kind: "placeholder",
  description: "Per-site crawler (placeholder, collects nothing)",
  schedule: null,
  async *collect(): AsyncGenerator<CollectedRecord, string | null> {
    return null;
  },
};
