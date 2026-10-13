import { randomBytes } from "node:crypto";
import type { UserTokenType } from "@prisma/client";
import { HttpError } from "../lib/http-error";
import { prisma } from "../lib/prisma";
import { hashToken } from "./session";

// Single-use tokens sent by email (DATABASE.md "user_tokens"): only the SHA-256 is
// stored; issuing a new token of a type invalidates the previous unused ones.

export async function issueToken(userId: string, type: UserTokenType, lifetimeMs: number): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  await prisma.$transaction([
    prisma.userToken.updateMany({ where: { userId, type, usedAt: null }, data: { usedAt: now } }),
    prisma.userToken.create({ data: { userId, type, tokenHash: hashToken(token), expiresAt: new Date(now.getTime() + lifetimeMs) } }),
  ]);
  return token;
}

const invalidToken = () => new HttpError(400, "invalid_token", "This link is invalid, expired or already used. Ask for a new one.");

// Marks the token used and returns its user id. Used or expired tokens are refused; the
// update is conditional so the same token cannot be used twice concurrently.
export async function consumeToken(token: string, type: UserTokenType): Promise<string> {
  const row = await prisma.userToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!row || row.type !== type || row.usedAt || row.expiresAt <= new Date()) throw invalidToken();
  const { count } = await prisma.userToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
  if (count === 0) throw invalidToken();
  return row.userId;
}
