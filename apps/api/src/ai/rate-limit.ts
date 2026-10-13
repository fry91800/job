import { config } from "../config";
import { HttpError } from "../lib/http-error";
import { RateLimiter } from "../lib/rate-limit";

// One per-IP limit shared by every endpoint that calls the AI (FEATURE G4): resume
// upload, offer extraction, generation, translation. Call it right before the AI call,
// after the cheaper checks (validation, quotas).
const aiLimiter = new RateLimiter(config.rateLimits.aiPerIp);

export function consumeAiRateLimit(ip: string): void {
  if (aiLimiter.isLimited(ip)) throw new HttpError(429, "rate_limited", "Too many requests, try again later");
  aiLimiter.record(ip);
}
