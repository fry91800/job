import "dotenv/config";

// Configuration of the server code shared by the API and the job collector. Objects are
// shared by reference: the API's config exposes them, and tests may change them.
export const backendConfig = {
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
