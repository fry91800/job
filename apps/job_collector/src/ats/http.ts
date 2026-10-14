import { collectorConfig } from "../config";

// HTTP for recruiting-tool APIs (fixed, known hosts — not user URLs). Retries temporary
// failures (429, 5xx, network) with growing pauses.

export class NotFoundError extends Error {}

export const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function fetchJson<T>(url: string, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": collectorConfig.ats.userAgent, Accept: "application/json" },
        signal: AbortSignal.timeout(collectorConfig.ats.timeoutMs),
      });
      if (response.status === 404) throw new NotFoundError(`Not found: ${url}`);
      if (response.ok) return (await response.json()) as T;
      lastError = new Error(`HTTP ${response.status}: ${url}`);
      if (response.status !== 429 && response.status < 500) throw lastError;
    } catch (error) {
      if (error instanceof NotFoundError) throw error;
      if (error instanceof Error && /^HTTP 4/.test(error.message) && !error.message.startsWith("HTTP 429")) throw error;
      lastError = error;
    }
    if (attempt < attempts) await pause(1000 * 2 ** attempt);
  }
  throw lastError;
}
