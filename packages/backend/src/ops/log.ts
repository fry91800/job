import { backendConfig } from "../config";

// Structured logs: one JSON object per line in production (time, level, event, fields),
// readable text in development. Never log personal data (emails, resume content, tokens).

type Level = "info" | "warn" | "error";

export function logEvent(level: Level, event: string, fields: Record<string, unknown> = {}): void {
  const write = level === "info" ? console.log : console.error;
  if (backendConfig.logs.json) {
    write(JSON.stringify({ time: new Date().toISOString(), level, event, ...fields }));
  } else {
    const details = Object.entries(fields)
      .map(([key, value]) => `${key}=${typeof value === "string" ? value : JSON.stringify(value)}`)
      .join(" ");
    write(`${level === "info" ? "" : `${level.toUpperCase()} `}${event}${details ? ` ${details}` : ""}`);
  }
}

// An error as loggable fields (message and stack, no request data).
export function errorFields(error: unknown): Record<string, unknown> {
  return error instanceof Error ? { error: error.message, stack: error.stack?.split("\n").slice(0, 6).join(" | ") } : { error: String(error) };
}
