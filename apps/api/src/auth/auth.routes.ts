import { Router } from "express";
import { Prisma } from "@prisma/client";
import { changePasswordSchema, deleteAccountSchema, loginSchema, signupSchema } from "@job/shared";
import { config } from "../config";
import { HttpError } from "../lib/http-error";
import { prisma } from "../lib/prisma";
import { RateLimiter } from "../lib/rate-limit";
import { mergeGuestInto } from "./guest-merge";
import { getMe } from "./me";
import { hashPassword, verifyDummyPassword, verifyPassword } from "./password";
import { clearSessionCookie, languageFromRequest, requireRegistered, startSession } from "./session";

export const authRouter = Router();

const loginEmailLimiter = new RateLimiter(config.rateLimits.loginFailuresPerEmail);
const loginIpLimiter = new RateLimiter(config.rateLimits.loginFailuresPerIp);
const signupLimiter = new RateLimiter(config.rateLimits.signupsPerIp);

const tooManyAttempts = () => new HttpError(429, "rate_limited", "Too many attempts, try again later");

// GET /api/auth/me — the current user, or { user: null } for anonymous visitors.
authRouter.get("/me", async (req, res) => {
  res.json(await getMe(req.user?.id));
});

// POST /api/auth/signup (FEATURE A1). A guest is upgraded in place: same id, same
// session, so all its data is kept (FEATURE G2).
authRouter.post("/signup", async (req, res) => {
  const input = signupSchema.parse(req.body);
  if (req.user && !req.user.isGuest) throw new HttpError(409, "already_registered", "You are already logged in");

  const ip = req.ip ?? "unknown";
  if (signupLimiter.isLimited(ip)) throw tooManyAttempts();
  signupLimiter.record(ip);

  const passwordHash = await hashPassword(input.password);
  try {
    if (req.user) {
      await prisma.user.update({
        where: { id: req.user.id },
        data: { email: input.email, passwordHash, ...(input.uiLanguage && { uiLanguage: input.uiLanguage }) },
      });
      req.user = { id: req.user.id, isGuest: false };
    } else {
      const user = await prisma.user.create({
        data: { email: input.email, passwordHash, uiLanguage: input.uiLanguage ?? languageFromRequest(req) },
        select: { id: true },
      });
      await startSession(req, res, { id: user.id, isGuest: false });
    }
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new HttpError(409, "email_taken", "An account with this email already exists");
    }
    throw error;
  }
  // A6: the verification email is sent here once an email provider is chosen.

  res.status(201).json(await getMe(req.user!.id));
});

// POST /api/auth/login (FEATURE A2). Replaces the current session; a guest's data is
// merged into the account.
authRouter.post("/login", async (req, res) => {
  const input = loginSchema.parse(req.body);
  const ip = req.ip ?? "unknown";
  if (loginEmailLimiter.isLimited(input.email) || loginIpLimiter.isLimited(ip)) throw tooManyAttempts();

  const account = await prisma.user.findFirst({
    where: { email: input.email, deletedAt: null },
    select: { id: true, passwordHash: true },
  });
  let valid = false;
  if (account?.passwordHash) {
    valid = await verifyPassword(account.passwordHash, input.password);
  } else {
    await verifyDummyPassword(input.password);
  }

  if (!account || !valid) {
    loginEmailLimiter.record(input.email);
    loginIpLimiter.record(ip);
    throw new HttpError(401, "invalid_credentials", "Wrong email or password");
  }
  loginEmailLimiter.reset(input.email);

  if (req.user && req.user.id !== account.id) {
    const previous = req.user;
    if (previous.isGuest) {
      await prisma.$transaction((tx) => mergeGuestInto(tx, previous.id, account.id));
    } else {
      await prisma.session.delete({ where: { id: req.sessionId } });
    }
  } else if (req.sessionId) {
    // Logging in again as the same user: start a fresh session.
    await prisma.session.delete({ where: { id: req.sessionId } });
  }

  await startSession(req, res, { id: account.id, isGuest: false });
  res.json(await getMe(account.id));
});

// POST /api/auth/logout (FEATURE A3)
authRouter.post("/logout", requireRegistered, async (req, res) => {
  await prisma.session.delete({ where: { id: req.sessionId } });
  clearSessionCookie(res);
  res.status(204).end();
});

// POST /api/auth/logout-all — "log out everywhere" (FEATURE A3)
authRouter.post("/logout-all", requireRegistered, async (req, res) => {
  await prisma.session.deleteMany({ where: { userId: req.user!.id } });
  clearSessionCookie(res);
  res.status(204).end();
});

async function checkCurrentPassword(userId: string, password: string): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { passwordHash: true } });
  if (!user.passwordHash || !(await verifyPassword(user.passwordHash, password))) {
    throw new HttpError(401, "invalid_password", "Wrong password");
  }
}

// POST /api/auth/password — change password, logs out the other devices (FEATURE A7)
authRouter.post("/password", requireRegistered, async (req, res) => {
  const input = changePasswordSchema.parse(req.body);
  await checkCurrentPassword(req.user!.id, input.currentPassword);

  const passwordHash = await hashPassword(input.newPassword);
  await prisma.$transaction([
    prisma.user.update({ where: { id: req.user!.id }, data: { passwordHash } }),
    prisma.session.deleteMany({ where: { userId: req.user!.id, id: { not: req.sessionId } } }),
  ]);
  res.status(204).end();
});

// DELETE /api/auth/account (FEATURE A5). Email and password are erased now; the rows are
// purged with their files after 30 days by the purge job.
authRouter.delete("/account", requireRegistered, async (req, res) => {
  const input = deleteAccountSchema.parse(req.body);
  await checkCurrentPassword(req.user!.id, input.password);

  await prisma.$transaction([
    prisma.user.update({ where: { id: req.user!.id }, data: { deletedAt: new Date(), email: null, passwordHash: null } }),
    prisma.session.deleteMany({ where: { userId: req.user!.id } }),
  ]);
  clearSessionCookie(res);
  res.status(204).end();
});
