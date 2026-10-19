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

  // Workday career sites (COLLECTOR.md §17.10): jobs listed 20 per request.
  workday: {
    maxListPages: 250, // up to 5 000 French jobs per site (Babilou: 3 350)
  },

  // Cornerstone career sites (COLLECTOR.md §17.19): pages of 50 offers read per run.
  cornerstone: {
    maxListPages: 100,
  },

  // Oracle Recruiting Cloud sites (COLLECTOR.md §17.18): pages of 25 offers read per run.
  oracle: {
    maxListPages: 200,
  },

  // iCIMS / Jibe career sites (COLLECTOR.md §17.14): pages of the job list read per run.
  jibe: {
    maxListPages: 100, // 100 offers a page
  },

  // Amazon's careers site (§17.20).
  amazon: {
    maxListPages: 50, // 100 offers a page
  },

  // Gestmax career sites (§17.21).
  gestmax: {
    maxListPages: 100, // about 20 offers a page
  },

  // Phenom career sites (COLLECTOR.md §17.13): pages of the filtered search read per run.
  phenom: {
    maxListPages: 200, // 50 offers a page on most sites, 10 on some
  },

  // SuccessFactors career sites (COLLECTOR.md §17.12): the whole job feed in one request
  // (Capgemini's: 57 MB for 6 500 offers worldwide).
  successFactors: {
    feedMaxBytes: 200 * 1024 * 1024,
    feedTimeoutMs: 5 * 60 * 1000,
  },

  // Bots (COLLECTOR.md §17.2–17.3): pages and snapshots sent to the API by source token.
  bots: {
    aiPagesPerDay: 300, // AI extractions per source and day (pages without JobPosting)
    notSeenDays: { default: 7 } as Record<string, number>, // offers not seen for this long are closed
    quietAfterHours: 48, // a source sending nothing for this long is alerted
    maxClosingShare: 0.5, // a complete snapshot closing more than this share of the open offers…
    closingAlwaysAllowed: 20, // …past this many is held, with an alert
  },

  // Choisir le service public (COLLECTOR.md §17.7): the civil service's job site.
  servicePublic: {
    baseUrl: "https://choisirleservicepublic.gouv.fr",
    schedule: "30 */6 * * *", // every 6 hours (~1 000 new offers a day)
    fullPassWeekday: 0, // Sunday (UTC): the whole listing is read, offers taken down are closed
    maxListPages: 3000, // 20 offers per page (~2 800 pages)
    maxOfferPagesPerRun: 3000, // ~1 h 40 at 2 s; the first runs fill the ~55 000 offers in a few days
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
    checkMaxPages: 15, // … more while none of them is in France
    talentsoftMaxListPages: 100, // Talentsoft lists 12 offers per page
    scheme: "https", // tests serve sites over http
    allowedPrivateAddresses: [] as string[], // tests only
  },

  franceTravail: {
    clientId: process.env.FRANCE_TRAVAIL_CLIENT_ID,
    clientSecret: process.env.FRANCE_TRAVAIL_CLIENT_SECRET,
  },
};
