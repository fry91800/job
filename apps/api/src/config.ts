import { backendConfig } from "@job/backend";
import type { ModifierConfig, ModifierStrength } from "@job/shared";
// Configuration values (FEATURE: limits are configuration, not code or database).
// Defaults are the initial values from FEATURE.md; environment variables override some.

export const isProduction = process.env.NODE_ENV === "production";

// Express "trust proxy": behind the reverse proxy (Caddy), the visitor's address comes from
// X-Forwarded-For — needed for rate limits per address. "1" = one proxy in front.
function trustProxy(value: string | undefined): boolean | number | string {
  if (value === undefined || value === "" || value === "false") return false;
  if (value === "true") return true;
  return /^\d+$/.test(value) ? Number(value) : value;
}

const DAY_MS = 24 * 3600 * 1000;

export const config = {
  port: Number(process.env.PORT ?? 3000),
  trustProxy: trustProxy(process.env.TRUST_PROXY),
  // One log line per request (method, route, status, duration; no query string, no
  // personal data). On by default in production.
  logRequests: process.env.LOG_REQUESTS ? process.env.LOG_REQUESTS === "true" : isProduction,

  session: {
    lifetimeMs: 30 * DAY_MS,
    // Sliding expiry is refreshed at most once per day per session.
    refreshAfterMs: DAY_MS,
    cookieSecure: isProduction,
  },

  // Origins allowed to send state-changing requests (CSRF check). Requests without an
  // Origin header (curl, tests) are allowed.
  webOrigins: (process.env.WEB_ORIGINS ?? "http://localhost:5173,http://localhost:5174").split(",").map((origin) => origin.trim()),

  limits: {
    savedOffers: { guest: 50, registered: 1000 },
    resumes: { guest: 2, registered: 20 },
    // Uploads count every uploaded resume, deleted ones included (FEATURE G4).
    resumeUploads: { guestTotal: 3, registeredPerDay: 20 },
    uploadMaxBytes: 5 * 1024 * 1024,
    photos: { guest: 3, registered: 10 },
    // User-added offers (O5), counted from the created offers (FEATURE G4).
    userOffers: { guestTotal: 3, registeredPerDay: 30 },
    // Generations with the modifier on (AI); modifier off is free (FEATURE G4, P16).
    aiGenerations: { guestTotal: 3, registeredPerDay: 30 },
    // Resume translations (T1), counted from translated resumes, deleted ones included.
    translations: { guestTotal: 2, registeredPerDay: 20 },
    photoMaxPixels: 1000, // longest side after resizing (R6)
  },

  // Resume modifier (FEATURE S1): the sections the AI may rewrite at each strength (more
  // strength, more sections). The strength decides; `userChoosesSections: true` lets users
  // pick the sections themselves again (their choice is still stored in their settings).
  modifier: {
    userChoosesSections: false,
    sectionsByStrength: {
      soft: { summary: true, skills: true },
      medium: { summary: true, title: true, skills: true, workExperience: true },
      hard: { summary: true, title: true, skills: true, workExperience: true, projects: true },
    } as Record<ModifierStrength, ModifierConfig>,
  },

  // AI (FEATURE G5). The provider is chosen here; features never depend on a provider.
  // AI provider and model (shared object with @job/backend, see its config).
  ai: backendConfig.ai,

  // Geoapify (shared object with @job/backend, see its config).
  geoapify: backendConfig.geoapify,

  // Frontend address, for the links in emails.
  webBaseUrl: process.env.WEB_BASE_URL ?? "http://localhost:5173",

  // Emails (FEATURE A4, A6). Development: MailHog from docker-compose (web UI on
  // http://localhost:8026). `transport: "memory"` keeps messages in memory (tests).
  mail: {
    transport: (process.env.MAIL_TRANSPORT ?? "smtp") as "smtp" | "memory",
    from: process.env.MAIL_FROM ?? "MonPoste <no-reply@monposte.local>",
    smtpHost: process.env.SMTP_HOST ?? "localhost",
    smtpPort: Number(process.env.SMTP_PORT ?? 1026),
    smtpSecure: process.env.SMTP_SECURE === "true",
    smtpUser: process.env.SMTP_USER,
    smtpPassword: process.env.SMTP_PASSWORD,
  },

  tokens: {
    passwordResetMs: 3600 * 1000, // 1 h (A4)
    emailVerificationMs: 48 * 3600 * 1000, // 48 h (A6)
  },

  // Fetching offer pages from user-supplied URLs (O5). Private and internal network
  // addresses are always refused (SSRF). `allowedPrivateAddresses` is for tests that serve
  // pages from a local server (e.g. ["127.0.0.1"]); keep it empty otherwise.
  fetch: {
    timeoutMs: 10 * 1000,
    maxBytes: 2 * 1024 * 1024,
    maxRedirects: 5,
    userAgent: "MonPosteBot/0.1 (offer import requested by a user)",
    allowedPrivateAddresses: [] as string[],
  },

  // Background cleanup (FEATURE "Background jobs", G3, A5). Runs inside the API process
  // every `intervalHours` (0 disables it); `npm run jobs:cleanup` runs it once.
  cleanup: {
    intervalHours: Number(process.env.CLEANUP_INTERVAL_HOURS ?? 24),
    guestInactiveDays: 30,
    deletedAccountDays: 30,
    // Soft-deleted resumes and photos are purged with their files after this delay.
    deletedItemDays: 30,
  },

  storage: {
    // Local-disk driver only for now; S3 comes later behind the same functions.
    localDir: process.env.STORAGE_LOCAL_DIR ?? "storage",
  },

  rateLimits: {
    loginFailuresPerEmail: { max: 5, windowMs: 15 * 60 * 1000 },
    loginFailuresPerIp: { max: 30, windowMs: 15 * 60 * 1000 },
    signupsPerIp: { max: 10, windowMs: 3600 * 1000 },
    guestsPerIp: { max: 30, windowMs: 3600 * 1000 },
    // Every endpoint that will call the AI (FEATURE G4).
    aiPerIp: { max: 60, windowMs: 3600 * 1000 },
    passwordResetsPerEmail: { max: 3, windowMs: 3600 * 1000 }, // A4
    passwordResetsPerIp: { max: 20, windowMs: 3600 * 1000 },
    verificationEmailsPerUser: { max: 3, windowMs: 3600 * 1000 }, // A6 resend
  },
};
