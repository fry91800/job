import "dotenv/config";

// Configuration of the server code shared by the API and the job collector. Objects are
// shared by reference: the API's config exposes them, and tests may change them.
export const backendConfig = {
  // AI (FEATURE M1, R1, O5, T1; the collector's bot pages, COLLECTOR.md §17.2). Shared with
  // the API's config.
  ai: {
    provider: process.env.AI_PROVIDER ?? "gemini", // gemini | fake (tests)
    model: process.env.AI_MODEL ?? "gemini-3.8-flash",
    timeoutMs: 60 * 1000,
    geminiApiKey: process.env.GEMINI_API_KEY,
    // Daily spending cap (estimated from the tokens each call used; GROWTH.md phase 0). When
    // the day's estimate (UTC) reaches `dailyUsd`, AI calls are refused until midnight UTC;
    // background tasks (the collector's bot pages) stop at `backgroundShare` of it, so
    // they never use the users' part. An alert goes out at `warnAt` and when it is reached.
    // Prices per million tokens: Gemini 3.8 Flash's from 2027-01-01 (until then Google
    // charges half), so the estimate errs on the high side.
    budget: {
      dailyUsd: Number(process.env.AI_DAILY_BUDGET_USD ?? 5),
      backgroundShare: 0.5,
      warnAt: 0.8,
      inputUsdPerMillion: Number(process.env.AI_PRICE_INPUT_USD_PER_MILLION ?? 1.5),
      outputUsdPerMillion: Number(process.env.AI_PRICE_OUTPUT_USD_PER_MILLION ?? 7.5), // thinking included
    },
  },

  // Geoapify place autocomplete (D47). Without a key, only the `locations` table is used.
  geoapify: {
    apiKey: process.env.GEOAPIFY_API_KEY,
    baseUrl: process.env.GEOAPIFY_BASE_URL ?? "https://api.geoapify.com",
    countries: (process.env.GEOAPIFY_COUNTRIES ?? "fr").split(",").map((code) => code.trim().toLowerCase()),
    language: "fr",
    timeoutMs: 3000,
    cacheTtlMs: 24 * 3600 * 1000,
  },

  // Operations (DEPLOYMENT.md). Logs are JSON lines in production (one event per line, for
  // the host's log collector), readable text otherwise.
  logs: {
    json: process.env.LOG_FORMAT ? process.env.LOG_FORMAT === "json" : process.env.NODE_ENV === "production",
  },
  // Failures that need a person go to a chat webhook (Slack, Discord, Mattermost…);
  // without a URL they are only logged. The same alert is sent at most once per interval.
  alerts: {
    webhookUrl: process.env.ALERT_WEBHOOK_URL,
    minIntervalMs: 15 * 60 * 1000,
    appName: process.env.APP_NAME ?? "monposte",
  },
};
