import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";
import { logEvent } from "@job/backend";
import { config } from "../config";

// Each request gets an id (X-Request-Id, also in error logs) and, when request logs are
// on, one line when it ends: method, route (the matched route, e.g. /api/offers/:id, so
// no ids or query strings), status, duration and the kind of session. No personal data.

declare module "express-serve-static-core" {
  interface Request {
    requestId?: string;
  }
}

export const requestLog: RequestHandler = (req, res, next) => {
  req.requestId = randomUUID();
  res.setHeader("X-Request-Id", req.requestId);
  if (!config.logRequests || req.path === "/api/health") return next();
  const start = process.hrtime.bigint();
  res.on("finish", () => {
    logEvent(res.statusCode >= 500 ? "error" : "info", "request", {
      id: req.requestId,
      method: req.method,
      route: req.route?.path ? `${req.baseUrl}${req.route.path}` : req.baseUrl || "(unmatched)",
      status: res.statusCode,
      ms: Math.round(Number(process.hrtime.bigint() - start) / 1e6),
      session: req.user ? (req.user.isGuest ? "guest" : "account") : "none",
    });
  });
  next();
};

// Browser protections for every API answer. HTTPS-only (HSTS) is set by the reverse
// proxy, which knows the domain. The resume preview is shown in a frame of the same site.
export const securityHeaders: RequestHandler = (_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  next();
};
