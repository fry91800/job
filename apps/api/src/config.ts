// Configuration values (FEATURE: limits are configuration, not code or database).
// Defaults are the initial values from FEATURE.md; environment variables override some.

const isProduction = process.env.NODE_ENV === "production";

const DAY_MS = 24 * 3600 * 1000;

export const config = {
  port: Number(process.env.PORT ?? 3000),

  session: {
    lifetimeMs: 30 * DAY_MS,
    // Sliding expiry is refreshed at most once per day per session.
    refreshAfterMs: DAY_MS,
    cookieSecure: isProduction,
  },

  // Origins allowed to send state-changing requests (CSRF check). Requests without an
  // Origin header (curl, tests) are allowed.
  webOrigins: (process.env.WEB_ORIGINS ?? "http://localhost:5173").split(",").map((origin) => origin.trim()),

  limits: {
    savedOffers: { guest: 50, registered: 1000 },
    resumes: { guest: 2, registered: 20 },
    // Uploads count every uploaded resume, deleted ones included (FEATURE G4).
    resumeUploads: { guestTotal: 3, registeredPerDay: 20 },
    uploadMaxBytes: 5 * 1024 * 1024,
    photos: { guest: 3, registered: 10 },
    // User-added offers (O5), counted from the created offers (FEATURE G4).
    userOffers: { guestTotal: 3, registeredPerDay: 30 },
    photoMaxPixels: 1000, // longest side after resizing (R6)
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
  },
};
