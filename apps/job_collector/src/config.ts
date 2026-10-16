import "dotenv/config";

// Job collector configuration (COLLECTOR.md).
// Who the collector says it is, on every request (job board APIs and career sites): the
// page explaining it (apps/web/public/bot.html) and an address for site owners.
const botContactUrl = process.env.CRAWLER_CONTACT_URL ?? "https://example.invalid/bot";
const botContactEmail = process.env.CRAWLER_CONTACT_EMAIL ?? "bot@example.invalid";

export const collectorConfig = {
  databaseUrl: process.env.DATABASE_URL!,

  // Deduplication (COLLECTOR.md §7): same fingerprint and publication dates this close.
  dedupe: { publishedWithinDays: 14, minDescriptionSimilarity: 0.5 },

  // An offer whose sources all dropped it, or past its expiry date, is closed.
  maintenanceCron: "30 3 * * *",
  // Raw records (raw_offers): a new row each time a source's record changes. The latest
  // row of each record is always kept (reprocessing); older versions and records that
  // never became an offer (rejected) are removed after these delays.
  rawRetention: { olderVersionsDays: 90, withoutOfferDays: 30 },

  // IT scope (P32): ROME family M18 without cartography (M1808) and the weather and climate
  // jobs (M1809, M1888, M1890, M1891, M1893).
  itRome: { family: "M18", excluded: ["M1808", "M1809", "M1888", "M1890", "M1891", "M1893"] },

  // Recruiting software adapters (COLLECTOR.md §5.2). Base URLs are configurable for tests.
  ats: {
    baseUrls: {
      greenhouse: "https://boards-api.greenhouse.io",
      ashby: "https://api.ashbyhq.com",
      lever: "https://api.lever.co",
      "lever-eu": "https://api.eu.lever.co",
      smartrecruiters: "https://api.smartrecruiters.com",
      workable: "https://apply.workable.com",
      recruitee: "https://{slug}.recruitee.com", // one host per company
    } as Record<string, string>,
    schedule: "0 */6 * * *", // every board collected every 6 hours
    pauseBetweenBoardsMs: 500,
    pauseBetweenRequestsMs: 150, // SmartRecruiters needs one request per offer
    detailRefreshDays: 7, // SmartRecruiters: known offers fetched again about once a week
    userAgent: `MonPosteBot/0.1 (+${botContactUrl}; job search service; collects public job board APIs; contact: ${botContactEmail})`,
    timeoutMs: 20000,
  },

  // Company discovery (COLLECTOR.md §5.2): Common Crawl's URL index, read from its files.
  discovery: {
    commonCrawlIndex: "https://index.commoncrawl.org", // list of crawls (collinfo.json)
    commonCrawlData: "https://data.commoncrawl.org", // the index files
    crawls: 3, // the most recent crawls read by each discovery
    pauseBetweenBlocksMs: 200, // between two index blocks (~270 KB each)
    retryPauseMs: 5000, // times the attempt number
    clusterChunkBytes: 4096, // per read of cluster.idx during the binary search
    checkCron: "0 2 * * *", // nightly: candidates and boards due for a re-check
    checkBatch: 1000,
    discoverCron: "0 1 1 * *", // monthly: Common Crawl publishes a new crawl about monthly
    // Boards are checked again after this delay, by status.
    recheckDays: { "no-france": 30, empty: 30, invalid: 90, active: 7 } as Record<string, number>,
  },

  // Career-site crawler (COLLECTOR.md §5.3): schema.org JobPosting on company career sites.
  // Its user agent names a contact page and address for site owners (required in
  // production: CRAWLER_CONTACT_URL, CRAWLER_CONTACT_EMAIL).
  crawler: {
    // Obey robots.txt Allow/Disallow rules (default). When false, robots.txt is still read
    // for its sitemaps and crawl-delay, and requests stay spaced; only its rules are
    // ignored. Env override: CRAWLER_RESPECT_ROBOTS_TXT=false.
    respectRobotsTxt: process.env.CRAWLER_RESPECT_ROBOTS_TXT !== "false",
    agent: "MonPosteBot", // the token robots.txt rules are matched against
    userAgent: `MonPosteBot/0.1 (+${botContactUrl}; job search service; contact: ${botContactEmail})`,
    minDelayMs: 2000, // between two requests to the same host (more if robots.txt asks)
    maxDelayMs: 30000, // a larger robots.txt crawl-delay is capped (and the site is slow)
    timeoutMs: 20000,
    maxBytes: 5 * 1024 * 1024,
    maxRedirects: 5,
    robotsTtlMs: 24 * 3600 * 1000,
    maxSitemaps: 20, // sitemap files read per site (index included)
    maxSitemapUrls: 50000,
    maxListingPages: 20, // pages followed to find offers when a site has no sitemap
    maxOfferPagesPerRun: 1000, // new or changed offer pages fetched per site and run (~35 min at 2 s)
    checkSamplePages: 3, // offer pages read to check a site
    talentsoftMaxListPages: 100, // Talentsoft lists 12 offers per page
    scheme: "https", // tests serve sites over http
    allowedPrivateAddresses: [] as string[], // tests only
  },

  franceTravail: {
    clientId: process.env.FRANCE_TRAVAIL_CLIENT_ID,
    clientSecret: process.env.FRANCE_TRAVAIL_CLIENT_SECRET,
  },
};
