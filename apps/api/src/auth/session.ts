import { createHash } from "node:crypto";
import type { RequestHandler } from "express";
import { prisma } from "../lib/prisma";

// Name of the HttpOnly cookie holding the raw session token (DATABASE.md "sessions").
export const SESSION_COOKIE = "session";

export type SessionUser = {
  id: string;
  isGuest: boolean;
};

declare global {
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
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

// Sets `req.user` when the request carries a valid session cookie. Requests without
// one stay anonymous: routes that need a user check `req.user` themselves.
// Session creation, extension and logout come with the auth routes (FEATURE A1–A3).
export const loadSession: RequestHandler = async (req, _res, next) => {
  const token = readCookie(req.headers.cookie, SESSION_COOKIE);
  if (!token) return next();

  const session = await prisma.session.findUnique({
    where: { tokenHash: createHash("sha256").update(token).digest("hex") },
    select: { expiresAt: true, user: { select: { id: true, email: true, deletedAt: true } } },
  });

  if (session && session.expiresAt > new Date() && !session.user.deletedAt) {
    req.user = { id: session.user.id, isGuest: session.user.email === null };
  }
  next();
};
