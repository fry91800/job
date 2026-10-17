import { randomBytes } from "node:crypto";
import type { JobAlert as JobAlertRow } from "@prisma/client";
import { MAX_JOB_ALERTS, offerSearchSchema, type JobAlert, type JobAlertFrequency, type OfferSearchParams } from "@job/shared";
import { z } from "zod";
import { HttpError } from "../lib/http-error";
import { parseUuid } from "../lib/ids";
import { prisma } from "../lib/prisma";

// Job alerts (GROWTH.md phase 2): saved searches of registered accounts. Their new offers
// are emailed by ./send.ts.

const notFound = () => new HttpError(404, "not_found", "Alert not found");

// The stored search: the app's address parameters without sort, page and publication date
// (an alert sends what arrived since the last email), in a stable order to spot duplicates.
const IGNORED = ["sort", "page", "publishedWithin"];

export function normalizeQuery(query: string): string {
  const params = new URLSearchParams(query.replace(/^\?/, ""));
  for (const key of IGNORED) params.delete(key);
  params.sort();
  return params.toString();
}

// The search parameters of an alert, validated like a search from the app.
export function alertSearchParams(query: string): OfferSearchParams {
  const params = Object.fromEntries(new URLSearchParams(query));
  return offerSearchSchema.parse({ ...params, sort: "recent", page: 1 });
}

export function toJobAlert(row: JobAlertRow): JobAlert {
  return {
    id: row.id,
    label: row.label,
    query: row.query,
    frequency: row.frequency as JobAlertFrequency,
    paused: row.pausedAt !== null,
    lastSentAt: row.lastSentAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listAlerts(userId: string): Promise<JobAlert[]> {
  const rows = await prisma.jobAlert.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
  return rows.map(toJobAlert);
}

// A search with no keyword, place or filter would send every new offer in France.
function hasCriteria(params: OfferSearchParams): boolean {
  return !!(params.q || params.locationId || params.company || params.skills.length || params.contractType.length || params.remoteType.length || params.salaryMin);
}

export async function createAlert(userId: string, input: { query: string; label: string; frequency: JobAlertFrequency }): Promise<{ alert: JobAlert; created: boolean }> {
  const query = normalizeQuery(input.query);
  let params: OfferSearchParams;
  try {
    params = alertSearchParams(query);
  } catch (error) {
    if (error instanceof z.ZodError) throw new HttpError(400, "invalid_request", "Invalid search");
    throw error;
  }
  if (!hasCriteria(params)) throw new HttpError(400, "alert_too_broad", "Add a keyword, a place or a filter first");

  const existing = await prisma.jobAlert.findFirst({ where: { userId, query } });
  if (existing) return { alert: toJobAlert(existing), created: false };
  if ((await prisma.jobAlert.count({ where: { userId } })) >= MAX_JOB_ALERTS) {
    throw new HttpError(409, "alert_limit", `At most ${MAX_JOB_ALERTS} alerts`);
  }
  const row = await prisma.jobAlert.create({
    data: { userId, query, label: input.label, frequency: input.frequency, unsubscribeToken: randomBytes(24).toString("base64url"), lastRunAt: new Date() },
  });
  return { alert: toJobAlert(row), created: true };
}

export async function updateAlert(userId: string, id: string, input: { frequency?: JobAlertFrequency; paused?: boolean }): Promise<JobAlert> {
  const alertId = parseUuid(id, notFound);
  const existing = await prisma.jobAlert.findFirst({ where: { id: alertId, userId } });
  if (!existing) throw notFound();
  const row = await prisma.jobAlert.update({
    where: { id: alertId },
    data: {
      ...(input.frequency && { frequency: input.frequency }),
      // Resumed: only offers from now on, not everything since the pause.
      ...(input.paused === true && !existing.pausedAt && { pausedAt: new Date() }),
      ...(input.paused === false && existing.pausedAt && { pausedAt: null, lastRunAt: new Date() }),
    },
  });
  return toJobAlert(row);
}

export async function deleteAlert(userId: string, id: string): Promise<void> {
  const { count } = await prisma.jobAlert.deleteMany({ where: { id: parseUuid(id, notFound), userId } });
  if (count === 0) throw notFound();
}

// The email's link: pauses the alert (it can be resumed in the app).
export async function unsubscribe(token: string): Promise<{ label: string; language: string } | null> {
  const alert = await prisma.jobAlert.findUnique({ where: { unsubscribeToken: token }, include: { user: { select: { uiLanguage: true } } } });
  if (!alert) return null;
  if (!alert.pausedAt) await prisma.jobAlert.update({ where: { id: alert.id }, data: { pausedAt: new Date() } });
  return { label: alert.label, language: alert.user.uiLanguage };
}
