import { logEvent, sendAlert } from "@job/backend";
import { feedbackSchema } from "@job/shared";
import { Router } from "express";
import { config } from "../config";
import { prisma } from "../lib/prisma";
import { HttpError } from "../lib/http-error";
import { RateLimiter } from "../lib/rate-limit";
import { sendMail } from "../mail/mailer";
import { feedbackEmail } from "../mail/templates";

// POST /api/feedback — the app's "Un avis ?" form (GROWTH.md phase 0): emailed to
// config.feedback.to, answerable with "Reply" when the sender left an address. Nothing is
// stored. Open to visitors without a session (no guest is created).
export const feedbackRouter = Router();

const limiter = new RateLimiter(config.rateLimits.feedbackPerIp);

feedbackRouter.post("/", async (req, res) => {
  const input = feedbackSchema.parse(req.body);
  const ip = req.ip ?? "unknown";
  if (limiter.isLimited(ip)) throw new HttpError(429, "rate_limited", "Too many messages, try again later");
  limiter.record(ip);

  const account = req.user && !req.user.isGuest ? await prisma.user.findUnique({ where: { id: req.user.id }, select: { email: true } }) : null;
  const sender = req.user ? (req.user.isGuest ? "invité" : `compte ${account?.email ?? "?"}`) : "visiteur sans session";
  const mail = feedbackEmail({ message: input.message, email: input.email ?? null, page: input.page ?? null, sender, language: req.get("accept-language")?.slice(0, 2) ?? "?" });
  try {
    await sendMail({ to: config.feedback.to, ...mail, ...(input.email && { replyTo: input.email }) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logEvent("error", "feedback_not_sent", { error: message });
    void sendAlert("feedback-not-sent", `A feedback message could not be emailed: ${message}`);
    throw new HttpError(503, "feedback_not_sent", "The message could not be sent, try again later");
  }
  logEvent("info", "feedback_received", { length: input.message.length, withEmail: !!input.email });
  res.status(204).end();
});
