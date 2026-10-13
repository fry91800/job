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

  franceTravail: {
    clientId: process.env.FRANCE_TRAVAIL_CLIENT_ID,
    clientSecret: process.env.FRANCE_TRAVAIL_CLIENT_SECRET,
  },
};
