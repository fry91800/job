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
  },

  rateLimits: {
    loginFailuresPerEmail: { max: 5, windowMs: 15 * 60 * 1000 },
    loginFailuresPerIp: { max: 30, windowMs: 15 * 60 * 1000 },
    signupsPerIp: { max: 10, windowMs: 3600 * 1000 },
    guestsPerIp: { max: 30, windowMs: 3600 * 1000 },
  },
};
