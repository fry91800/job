import { createHash, randomBytes } from "node:crypto";
import type { Request, RequestHandler, Response } from "express";
import { config } from "../config";
import { HttpError } from "../lib/http-error";
import { prisma } from "../lib/prisma";
import { RateLimiter } from "../lib/rate-limit";

// Server-side sessions (DATABASE.md "sessions"): the raw token lives only in the
// HttpOnly cookie, the database stores its SHA-256.
export const SESSION_COOKIE = "session";

export type SessionUser = {
  id: string;
  isGuest: boolean;
};

declare global {
  namespace Express {
    interface Request {
      user?: SessionUser;
      sessionId?: string;
    }
  }
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === name) {
      return decodeURIComponent(part.slice(separator + 1).trim());
    }
  }
  return undefined;
}

function setSessionCookie(res: Response, token: string) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: config.session.cookieSecure,
    sameSite: "lax",
    path: "/",
    maxAge: config.session.lifetimeMs,
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: config.session.cookieSecure, sameSite: "lax", path: "/" });
}

// Creates a session for the user, sets the cookie and attaches the user to the request.
export async function startSession(req: Request, res: Response, user: SessionUser): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const session = await prisma.session.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(token),
      userAgent: req.headers["user-agent"]?.slice(0, 500) ?? null,
      expiresAt: new Date(Date.now() + config.session.lifetimeMs),
    },
  });
  setSessionCookie(res, token);
  req.user = user;
  req.sessionId = session.id;
}

// Sets `req.user` when the request carries a valid session cookie. Requests without
// one stay anonymous. Extends the session once a day (sliding expiry).
export const loadSession: RequestHandler = async (req, res, next) => {
  const token = readCookie(req.headers.cookie, SESSION_COOKIE);
  if (!token) return next();

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { id: true, expiresAt: true, lastUsedAt: true, user: { select: { id: true, email: true, deletedAt: true } } },
  });

  const now = Date.now();
  if (!session || session.expiresAt.getTime() <= now || session.user.deletedAt) {
    clearSessionCookie(res);
    return next();
  }

  req.user = { id: session.user.id, isGuest: session.user.email === null };
  req.sessionId = session.id;

  if (now - session.lastUsedAt.getTime() > config.session.refreshAfterMs) {
    await prisma.$transaction([
      prisma.session.update({
        where: { id: session.id },
        data: { lastUsedAt: new Date(now), expiresAt: new Date(now + config.session.lifetimeMs) },
      }),
      prisma.user.update({ where: { id: session.user.id }, data: { lastActiveAt: new Date(now) } }),
    ]);
    setSessionCookie(res, token);
  }
  next();
};

const guestLimiter = new RateLimiter(config.rateLimits.guestsPerIp);

// The browser language decides the language of a new user (FEATURE L1).
export function languageFromRequest(req: Request): "fr" | "en" {
  return req.headers["accept-language"]?.trim().toLowerCase().startsWith("fr") ? "fr" : "en";
}

// For routes that write data: uses the current user, or creates a guest and its session
// on the first write (FEATURE G1).
export const requireUser: RequestHandler = async (req, res, next) => {
  if (req.user) return next();

  const ip = req.ip ?? "unknown";
  if (guestLimiter.isLimited(ip)) {
    throw new HttpError(429, "rate_limited", "Too many requests, try again later");
  }
  guestLimiter.record(ip);

  const guest = await prisma.user.create({ data: { uiLanguage: languageFromRequest(req) }, select: { id: true } });
  await startSession(req, res, { id: guest.id, isGuest: true });
  next();
};

// For routes that need an email/password account (logout, password change, deletion).
export const requireRegistered: RequestHandler = (req, _res, next) => {
  if (!req.user) throw new HttpError(401, "not_authenticated", "You must be logged in");
  if (req.user.isGuest) throw new HttpError(403, "registered_only", "This action needs an account");
  next();
};

// For routes that read the user's data without creating a guest.
export const requireSession: RequestHandler = (req, _res, next) => {
  if (!req.user) throw new HttpError(401, "not_authenticated", "You must be logged in");
  next();
};
