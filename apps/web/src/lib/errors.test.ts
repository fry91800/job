import assert from "node:assert/strict";
import type { TFunction } from "i18next";
import { describe, test } from "vitest";
import { ApiError } from "../api/client";
import { errorMessage } from "./errors";

// A stand-in for i18next's t: the key and its values.
const t = ((key: string, options?: Record<string, unknown>) => (options && "defaultValue" in options ? (key === "errors.known" ? "Known." : "") : `${key}${options ? JSON.stringify(options) : ""}`)) as unknown as TFunction;

describe("API error messages", () => {
  test("known codes are translated, others get the generic message", () => {
    assert.equal(errorMessage(t, new ApiError(400, "known", "x")), "Known.");
    assert.equal(errorMessage(t, new ApiError(500, "weird", "x")), 'errors.generic{"code":"weird"}');
  });

  test("limits carry their number, and the account hint for guests", () => {
    assert.equal(errorMessage(t, new ApiError(429, "limit_reached", "You can keep at most 20 resumes")), 'errors.limitCount{"count":20}');
    assert.equal(
      errorMessage(t, new ApiError(429, "limit_reached", "Upload limit reached: create an account to upload more resumes")),
      "errors.limit_reached errors.limitGuest",
    );
  });
});
