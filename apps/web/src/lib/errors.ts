import type { TFunction } from "i18next";
import { ApiError } from "../api/client";

// API error codes → translated messages (FRONTEND.md §3); unknown codes get a generic one.
// Limits say how many are allowed and, for guests, that an account raises them (the API's
// message carries both).
export function errorMessage(t: TFunction, error: unknown): string {
  const code = error instanceof ApiError ? error.code : "unknown";
  if (code === "limit_reached" && error instanceof ApiError) {
    const count = /\d+/.exec(error.message)?.[0];
    const text = count ? t("errors.limitCount", { count: Number(count) }) : t("errors.limit_reached");
    return /create an account/i.test(error.message) ? `${text} ${t("errors.limitGuest")}` : text;
  }
  const text = t(`errors.${code}`, { defaultValue: "" });
  return text || t("errors.generic", { code });
}
