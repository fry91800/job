import { errorFields, logEvent, sendAlert } from "@job/backend";
import type { OfferSearchResult } from "@job/shared";
import { config } from "../config";
import { prisma } from "../lib/prisma";
import { sendMail } from "../mail/mailer";
import { jobAlertEmail, type AlertOffer } from "../mail/templates";
import { searchOffers } from "../offers/offer-search";
import { alertSearchParams } from "./alerts";

// Sends the job alerts (GROWTH.md phase 2): every morning at config.alerts.sendHour (Paris
// time), or on Mondays for weekly alerts, each alert's offers collected since its last run,
// when there are any. Only to confirmed addresses. A run that fails to email an alert keeps
// it due: it is retried at the next check.

const BATCH = 100;
const TIME_ZONE = "Europe/Paris";

// Minutes to add to UTC to get Paris time at `date`.
function parisOffsetMinutes(date: Date): number {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, timeZoneName: "longOffset" }).formatToParts(date).find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  return match ? (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3])) : 0;
}

// The latest send time (sendHour, Paris) at or before `now`; on a Monday for weekly alerts.
export function lastSendTime(now: Date, weekly: boolean): Date {
  const paris = new Date(now.getTime() + parisOffsetMinutes(now) * 60_000); // Paris wall time, read with UTC getters
  let day = Date.UTC(paris.getUTCFullYear(), paris.getUTCMonth(), paris.getUTCDate());
  const at = (dayStart: number) => {
    const local = dayStart + config.alerts.sendHour * 3600_000;
    return new Date(local - parisOffsetMinutes(new Date(local)) * 60_000);
  };
  if (at(day) > now) day -= 24 * 3600_000;
  if (weekly) while (new Date(day).getUTCDay() !== 1) day -= 24 * 3600_000;
  return at(day);
}

const CONTRACTS: Record<string, Record<string, string>> = {
  fr: { permanent: "CDI", fixed_term: "CDD", temporary: "Intérim", freelance: "Freelance", internship: "Stage", apprenticeship: "Alternance" },
  en: { permanent: "Permanent", fixed_term: "Fixed-term", temporary: "Temporary", freelance: "Freelance", internship: "Internship", apprenticeship: "Apprenticeship" },
};

function offerLine(offer: OfferSearchResult, language: "fr" | "en"): AlertOffer {
  const place = offer.location ? offer.location.name : offer.remoteType === "remote" ? (language === "fr" ? "Télétravail" : "Remote") : null;
  const facts = [offer.companyName, place, offer.contractType && CONTRACTS[language][offer.contractType]].filter(Boolean).join(" · ");
  return { url: `${config.webBaseUrl}/offers/${offer.id}`, title: offer.title, facts };
}

export type AlertsRunResult = { checked: number; sent: number; failed: number };

export async function runAlerts(now = new Date()): Promise<AlertsRunResult> {
  const result: AlertsRunResult = { checked: 0, sent: 0, failed: 0 };
  const dailyDue = lastSendTime(now, false);
  const weeklyDue = lastSendTime(now, true);
  let cursor: string | undefined;

  for (;;) {
    const alerts = await prisma.jobAlert.findMany({
      where: {
        pausedAt: null,
        user: { email: { not: null }, emailVerifiedAt: { not: null }, deletedAt: null },
        OR: [
          { frequency: "daily", lastRunAt: { lt: dailyDue } },
          { frequency: "weekly", lastRunAt: { lt: weeklyDue } },
        ],
      },
      include: { user: { select: { email: true, uiLanguage: true } } },
      orderBy: { id: "asc" },
      take: BATCH,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
    });
    if (!alerts.length) break;
    cursor = alerts.at(-1)!.id;

    for (const alert of alerts) {
      result.checked++;
      try {
        const search = await searchOffers(alertSearchParams(alert.query), undefined, { collectedAfter: alert.lastRunAt });
        if (search.total > 0) {
          const language = alert.user.uiLanguage === "en" ? "en" : "fr";
          const unsubscribeUrl = `${config.webBaseUrl}/api/alerts/unsubscribe/${alert.unsubscribeToken}`;
          const mail = jobAlertEmail(language, {
            label: alert.label,
            offers: search.results.slice(0, config.alerts.offersShown).map((offer) => offerLine(offer, language)),
            total: search.total,
            searchUrl: `${config.webBaseUrl}/?${alert.query}&sort=recent`,
            unsubscribeUrl,
            settingsUrl: `${config.webBaseUrl}/settings`,
          });
          await sendMail({ to: alert.user.email!, ...mail, headers: { "List-Unsubscribe": `<${unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } });
          result.sent++;
        }
        await prisma.jobAlert.update({ where: { id: alert.id }, data: { lastRunAt: now, ...(search.total > 0 && { lastSentAt: now }) } });
      } catch (error) {
        result.failed++;
        logEvent("error", "job_alert_failed", { alertId: alert.id, ...errorFields(error) });
      }
    }
  }
  if (result.failed > 0) void sendAlert("job-alerts", `${result.failed} job alert(s) could not be sent (see the api logs, "job_alert_failed")`);
  return result;
}

// Checks every `checkMinutes` inside the API process, first a minute after start. With
// several API processes, move it to a single cron job (`npm run jobs:alerts`).
export function scheduleAlerts(): (() => void) | undefined {
  if (config.alerts.checkMinutes <= 0) return undefined;
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const result = await runAlerts();
      if (result.checked > 0) logEvent("info", "job_alerts_done", result);
    } catch (error) {
      logEvent("error", "job_alerts_failed", errorFields(error));
      void sendAlert("job-alerts", `Job alerts failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      running = false;
    }
  };
  const first = setTimeout(run, 60 * 1000);
  const every = setInterval(run, config.alerts.checkMinutes * 60 * 1000);
  first.unref();
  every.unref();
  return () => {
    clearTimeout(first);
    clearInterval(every);
  };
}
