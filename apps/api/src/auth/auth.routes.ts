import { Router, type Request, type Response } from "express";
import { Prisma } from "@prisma/client";
import {
  changePasswordSchema,
  deleteAccountSchema,
  emailVerificationConfirmSchema,
  loginSchema,
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
  signupSchema,
} from "@job/shared";
import { config } from "../config";
import { HttpError } from "../lib/http-error";
import { prisma } from "../lib/prisma";
import { sendMailInBackground } from "../mail/mailer";
import { emailVerificationEmail, passwordResetEmail } from "../mail/templates";
import { RateLimiter } from "../lib/rate-limit";
import { mergeGuestInto } from "./guest-merge";
import { getMe } from "./me";
import { hashPassword, verifyDummyPassword, verifyPassword } from "./password";
import { clearSessionCookie, languageFromRequest, requireRegistered, startSession } from "./session";
import { consumeToken, issueToken } from "./user-tokens";

export const authRouter = Router();

const loginEmailLimiter = new RateLimiter(config.rateLimits.loginFailuresPerEmail);
const loginIpLimiter = new RateLimiter(config.rateLimits.loginFailuresPerIp);
const signupLimiter = new RateLimiter(config.rateLimits.signupsPerIp);
const resetEmailLimiter = new RateLimiter(config.rateLimits.passwordResetsPerEmail);
const resetIpLimiter = new RateLimiter(config.rateLimits.passwordResetsPerIp);
const verificationLimiter = new RateLimiter(config.rateLimits.verificationEmailsPerUser);

const tooManyAttempts = () => new HttpError(429, "rate_limited", "Too many attempts, try again later");

// Logs the request in as `accountId` with a new session (login, password reset). The
// current session is replaced; a guest's data is merged into the account (A2).
async function switchToAccount(req: Request, res: Response, accountId: string): Promise<void> {
  if (req.user && req.user.id !== accountId && req.user.isGuest) {
    const guestId = req.user.id;
    await prisma.$transaction((tx) => mergeGuestInto(tx, guestId, accountId));
  } else if (req.sessionId) {
    await prisma.session.deleteMany({ where: { id: req.sessionId } });
  }
  await startSession(req, res, { id: accountId, isGuest: false });
}

// Sends a new verification link (A6), in the user's language.
async function sendVerificationEmail(userId: string): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true, uiLanguage: true } });
  if (!user.email) return;
  const token = await issueToken(userId, "email_verification", config.tokens.emailVerificationMs);
  const url = `${config.webBaseUrl}/verify-email?token=${token}`;
  sendMailInBackground({ to: user.email, ...emailVerificationEmail(user.uiLanguage === "fr" ? "fr" : "en", url) });
}

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
  // A6: the account is usable right away; the link only confirms the address.
  await sendVerificationEmail(req.user!.id);

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

  await switchToAccount(req, res, account.id);
  res.json(await getMe(account.id));
});

// POST /api/auth/password-reset/request { email } (A4). Always the same answer, whether
// or not the account exists (no account enumeration); the email is sent in the background.
authRouter.post("/password-reset/request", async (req, res) => {
  const { email } = passwordResetRequestSchema.parse(req.body);
  const ip = req.ip ?? "unknown";
  if (resetEmailLimiter.isLimited(email) || resetIpLimiter.isLimited(ip)) throw tooManyAttempts();
  resetEmailLimiter.record(email);
  resetIpLimiter.record(ip);

  const account = await prisma.user.findFirst({ where: { email, deletedAt: null }, select: { id: true, uiLanguage: true } });
  if (account) {
    const token = await issueToken(account.id, "password_reset", config.tokens.passwordResetMs);
    const url = `${config.webBaseUrl}/reset-password?token=${token}`;
    sendMailInBackground({ to: email, ...passwordResetEmail(account.uiLanguage === "fr" ? "fr" : "en", url) });
  }
  res.status(202).json({ message: "If an account exists for this address, an email has been sent" });
});

// POST /api/auth/password-reset/confirm { token, password } (A4): new password, every
// session of the account logged out, then logged in here with a new session.
authRouter.post("/password-reset/confirm", async (req, res) => {
  const input = passwordResetConfirmSchema.parse(req.body);
  const userId = await consumeToken(input.token, "password_reset");
  const account = await prisma.user.findFirst({ where: { id: userId, deletedAt: null, email: { not: null } }, select: { id: true, email: true } });
  if (!account) throw new HttpError(400, "invalid_token", "This link is invalid, expired or already used. Ask for a new one.");

  await prisma.$transaction([
    prisma.user.update({ where: { id: account.id }, data: { passwordHash: await hashPassword(input.password) } }),
    prisma.session.deleteMany({ where: { userId: account.id } }),
  ]);
  loginEmailLimiter.reset(account.email!);
  await switchToAccount(req, res, account.id);
  res.json(await getMe(account.id));
});

// POST /api/auth/email-verification/resend (A6)
authRouter.post("/email-verification/resend", requireRegistered, async (req, res) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id }, select: { emailVerifiedAt: true } });
  if (user.emailVerifiedAt) throw new HttpError(409, "already_verified", "This address is already confirmed");
  if (verificationLimiter.isLimited(req.user!.id)) throw tooManyAttempts();
  verificationLimiter.record(req.user!.id);
  await sendVerificationEmail(req.user!.id);
  res.status(202).json({ message: "A new confirmation email has been sent" });
});

// POST /api/auth/email-verification/confirm { token } (A6). Works without being logged
// in (the link may be opened on another device).
authRouter.post("/email-verification/confirm", async (req, res) => {
  const { token } = emailVerificationConfirmSchema.parse(req.body);
  const userId = await consumeToken(token, "email_verification");
  await prisma.user.updateMany({ where: { id: userId, deletedAt: null, emailVerifiedAt: null }, data: { emailVerifiedAt: new Date() } });
  res.status(204).end();
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
