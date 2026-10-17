import type { PublicConfigResponse } from "@job/shared";
import { api } from "../api/client";

// Audience measurement (GROWTH.md §5): Umami, self-hosted, without cookies, served on the
// site's own address (/u/, Caddy). Page views follow the address (the tracker watches the
// history), without the query string (searches are events instead); visitors asking not to
// be tracked (Do Not Track) are not. Off when the API has no website id (development).

type Umami = { track(event: string, data?: Record<string, string | number | boolean>): void };

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
    document.head.append(script);
  } catch {
    // Measurement is never worth an error.
  }
}

// A step that matters (GROWTH.md §5): resume uploaded, resume generated, PDF downloaded…
// Data: small facts only, never personal content.
export function track(event: string, data?: Record<string, string | number | boolean>): void {
  try {
    window.umami?.track(event, data);
  } catch {
    // Same.
  }
}
