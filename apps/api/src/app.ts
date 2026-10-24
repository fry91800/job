import type { PublicConfigResponse } from "@job/shared";
import express from "express";
import { alertsRouter } from "./alerts/alerts.routes";
import { authRouter } from "./auth/auth.routes";
import { ingestRouter } from "./collector/ingest.routes";
import { loadSession } from "./auth/session";
import { coverLettersRouter } from "./cover-letters/cover-letters.routes";
import { resumeHelpRouter } from "./resume-help/resume-help.routes";
import { generatedResumesRouter } from "./generated-resumes/generated-resumes.routes";
import { feedbackRouter } from "./feedback/feedback.routes";
import { errorHandler, notFound } from "./lib/error-handler";
import { config } from "./config";
import { checkOrigin } from "./lib/origin-check";
import { requestLog, securityHeaders } from "./lib/request-log";
import { locationsRouter } from "./locations/locations.routes";
import { offersRouter } from "./offers/offers.routes";
import { userOffersRouter } from "./offers/user-offers.routes";
import { photosRouter } from "./photos/photos.routes";
import { resumesRouter } from "./resumes/resumes.routes";
import { savedOffersRouter } from "./saved-offers/saved-offers.routes";
import { seoRouter } from "./seo/seo.routes";
import { settingsRouter, templatesRouter } from "./settings/settings.routes";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy);
  app.use(requestLog);
  app.use(securityHeaders);
  // The ingestion endpoint takes batches of up to 100 offers.
  // Bots send up to 20 pages of 300 000 characters (§17.2).
  app.use("/api/collector", express.json({ limit: "8mb" }));
  app.use(express.json({ limit: "100kb" }));
  app.use(checkOrigin);
  app.use(loadSession);

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });
  // Settings the web app reads at start (analytics).
  app.get("/api/public-config", (_req, res) => {
    const websiteId = config.analytics.umamiWebsiteId;
    res.set("Cache-Control", "public, max-age=300");
    res.json({ analytics: websiteId ? { websiteId, domain: new URL(config.webBaseUrl).hostname } : null } satisfies PublicConfigResponse);
  });
  app.use("/api/auth", authRouter);
  app.use("/api/collector", ingestRouter);
  app.use("/api/locations", locationsRouter);
  app.use("/api/offers", offersRouter);
  app.use("/api/user-offers", userOffersRouter);
  app.use("/api/saved-offers", savedOffersRouter);
  app.use("/api/resumes", resumesRouter);
  app.use("/api/photos", photosRouter);
  app.use("/api/generated-resumes", generatedResumesRouter);
  app.use("/api/cover-letters", coverLettersRouter);
  app.use("/api/resume-help", resumeHelpRouter);
  app.use("/api/templates", templatesRouter);
  app.use("/api/settings", settingsRouter);
  app.use("/api/feedback", feedbackRouter);
  app.use("/api/alerts", alertsRouter);
  // Offer pages, sitemaps and robots.txt for search engines (SEO.md).
  app.use(seoRouter);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
