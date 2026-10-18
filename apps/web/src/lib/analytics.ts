import type { PublicConfigResponse } from "@job/shared";
import { api } from "../api/client";

// Audience measurement (GROWTH.md §5): Umami, self-hosted, without cookies, served on the
// site's own address (/u/, Caddy). Page views follow the address (the tracker watches the
// history), without the query string (searches are events instead); visitors asking not to
// be tracked (Do Not Track) are not. Off when the API has no website id (development).

type EventData = Record<string, string | number | boolean>;
type Umami = { track(event: string, data?: EventData): void };

declare global {
  interface Window {
    umami?: Umami;
  }
}

export async function startAnalytics(): Promise<void> {
  try {
    const { analytics } = await api<PublicConfigResponse>("GET", "/api/public-config");
    if (!analytics) return;
    const script = document.createElement("script");
    script.src = "/u/script.js";
    script.defer = true;
    script.dataset.websiteId = analytics.websiteId;
    script.dataset.domains = analytics.domain; // not on rehearsal or local copies
    script.dataset.excludeSearch = "true";
    script.dataset.doNotTrack = "true";
    // Events from before the script was there (e.g. the arrival from an alert email).
    script.addEventListener("load", () => pending.splice(0).forEach(([event, data]) => track(event, data)));
    document.head.append(script);
  } catch {
    // Measurement is never worth an error.
  }
}

const pending: [string, EventData | undefined][] = [];

// Arrival from a job alert email (`?alert=<send hour>`, apps/api/src/alerts/send.ts): an
// "alert_click" event with the hour the email was sent and what was clicked, to compare
// send hours (GROWTH.md §5). The parameter leaves the address before the app reads it.
export function trackAlertArrival(): void {
  const url = new URL(location.href);
  const hour = url.searchParams.get("alert");
  if (hour === null) return;
  url.searchParams.delete("alert");
  history.replaceState(history.state, "", url);
  const data: EventData = { link: url.pathname.startsWith("/offers/") ? "offer" : "search", sendHour: Number(hour) || 0 };
  if (window.umami) track("alert_click", data);
  else pending.push(["alert_click", data]);
}

// A step that matters (GROWTH.md §5): resume uploaded, resume generated, PDF downloaded…
// Data: small facts only, never personal content.
export function track(event: string, data?: EventData): void {
  try {
    window.umami?.track(event, data);
  } catch {
    // Same.
  }
}
