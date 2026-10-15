import type { TFunction } from "i18next";
import { ApiError } from "../api/client";

// API error codes → translated messages (FRONTEND.md §3); unknown codes get a generic one.
export function errorMessage(t: TFunction, error: unknown): string {
  const code = error instanceof ApiError ? error.code : "unknown";
  const key = `errors.${code}`;
  const text = t(key, { defaultValue: "" });
  return text || t("errors.generic", { code });
}
