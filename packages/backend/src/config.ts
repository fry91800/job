import "dotenv/config";

// Task → model: the environment variable of its group, else the group's default.
function taskModels(groups: Record<string, { tasks: string[]; model: string }>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [variable, group] of Object.entries(groups)) {
    for (const task of group.tasks) result[task] = process.env[variable] || group.model;
  }
  return result;
}

// Configuration of the server code shared by the API and the job collector. Objects are
// shared by reference: the API's config exposes them, and tests may change them.
export const backendConfig = {
  // AI (FEATURE M1, R1, O5, T1; the collector's bot pages, COLLECTOR.md §17.2). Shared with
  // the API's config.
  ai: {
    provider: process.env.AI_PROVIDER ?? "gemini", // gemini | fake (tests)
    // The model of each task (D157), chosen with `npm run ai:compare` (2026-10-17): Flash-Lite
    // reads resumes, offers and job pages and translates as well as Flash, 3–5× cheaper
    // and faster; the resume rewrite needs Flash (Lite mostly deletes, and once claimed
    // skills the resume doesn't have). Tasks not listed use `model`.
    model: process.env.AI_MODEL || "gemini-3.5-flash-lite",
    taskModels: taskModels({
      AI_MODEL_EXTRACT: { tasks: ["parse-resume", "extract-offer", "extract-bot-page"], model: "gemini-3.5-flash-lite" },
      AI_MODEL_TRANSLATE: { tasks: ["translate-resume", "translate-field"], model: "gemini-3.5-flash-lite" },
      AI_MODEL_GENERATE: { tasks: ["generate-resume", "write-cover-letter"], model: "gemini-3.8-flash" },
    }),
    timeoutMs: 60 * 1000,
    geminiApiKey: process.env.GEMINI_API_KEY,
    // Prices in USD per million tokens (output includes thinking), for the daily budget.
    // Gemini 3.x Flash: the prices from 2027-01-01 (until then Google charges half), so the
    // estimate errs on the high side. A model missing here is priced as the most expensive.
    prices: {
      "gemini-3.8-flash": { input: 1.5, output: 7.5 },
      "gemini-3.5-flash-lite": { input: 0.3, output: 2.5 },
    } as Record<string, { input: number; output: number }>,
    // Daily spending cap (estimated from the tokens each call used; GROWTH.md phase 0). When
    // the day's estimate (UTC) reaches `dailyUsd`, AI calls are refused until midnight UTC;
    // background tasks (the collector's bot pages) stop at `backgroundShare` of it, so
    // they never use the users' part. An alert goes out at `warnAt` and when it is reached.
    budget: {
      dailyUsd: Number(process.env.AI_DAILY_BUDGET_USD ?? 2),
      backgroundShare: 0.5,
      warnAt: 0.8,
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
