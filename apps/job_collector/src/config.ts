import "dotenv/config";

// Job collector configuration (COLLECTOR.md).
export const collectorConfig = {
  databaseUrl: process.env.DATABASE_URL!,

  // Deduplication (COLLECTOR.md §7): same fingerprint and publication dates this close.
  dedupe: { publishedWithinDays: 14, minDescriptionSimilarity: 0.5 },

  // An offer whose sources all dropped it, or past its expiry date, is closed.
  maintenanceCron: "30 3 * * *",

  // IT scope (P32): ROME family M18 without cartography (M1808) and meteorology (M1809).
  itRome: { family: "M18", excluded: ["M1808", "M1809"] },

  // Recruiting software adapters (COLLECTOR.md §5.2). Base URLs are configurable for tests.
  ats: {
    baseUrls: {
      greenhouse: "https://boards-api.greenhouse.io",
      ashby: "https://api.ashbyhq.com",
      lever: "https://api.lever.co",
      "lever-eu": "https://api.eu.lever.co",
      smartrecruiters: "https://api.smartrecruiters.com",
    } as Record<string, string>,
    schedule: "0 */6 * * *", // every board collected every 6 hours
    pauseBetweenBoardsMs: 500,
    pauseBetweenRequestsMs: 150, // SmartRecruiters needs one request per offer
    userAgent: "JobPlatformBot/0.1 (job search service; collects public job board APIs)",
    timeoutMs: 20000,
  },

  // Company discovery (COLLECTOR.md §5.2): Common Crawl's URL index.
  discovery: {
    commonCrawlIndex: "https://index.commoncrawl.org",
    pauseBetweenPagesMs: 2000,
    checkCron: "0 2 * * *", // nightly: candidates and boards due for a re-check
    checkBatch: 500,
    discoverCron: "0 1 1 * *", // monthly: Common Crawl publishes a new crawl about monthly
    // Boards are checked again after this delay, by status.
    recheckDays: { "no-france": 30, empty: 30, invalid: 90, active: 7 } as Record<string, number>,
  },

  franceTravail: {
    clientId: process.env.FRANCE_TRAVAIL_CLIENT_ID,
    clientSecret: process.env.FRANCE_TRAVAIL_CLIENT_SECRET,
  },
};
