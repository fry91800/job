import { backendConfig } from "../config";
import { logEvent } from "./log";

// Alerts for failures that need a person (a failed collection run, server errors): posted
// to ALERT_WEBHOOK_URL as {text, content}, which Slack, Mattermost and Discord accept.
// The same `key` is sent at most once per `alerts.minIntervalMs` (no flood when a source
// is down for hours); every alert is also logged.

const lastSent = new Map<string, number>();

export async function sendAlert(key: string, text: string): Promise<boolean> {
  logEvent("error", "alert", { key, text });
  const { webhookUrl, minIntervalMs, appName } = backendConfig.alerts;
  if (!webhookUrl) return false;
  const now = Date.now();
  if (now - (lastSent.get(key) ?? 0) < minIntervalMs) return false;
  lastSent.set(key, now);
  const message = `[${appName}] ${text}`;
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: message, content: message }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) logEvent("warn", "alert_not_delivered", { key, status: response.status });
    return response.ok;
  } catch (error) {
    logEvent("warn", "alert_not_delivered", { key, error: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

// Tests.
export function resetAlerts(): void {
  lastSent.clear();
}
