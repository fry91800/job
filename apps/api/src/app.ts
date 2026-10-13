import express from "express";
import { authRouter } from "./auth/auth.routes";
import { ingestRouter } from "./collector/ingest.routes";
import { loadSession } from "./auth/session";
import { generatedResumesRouter } from "./generated-resumes/generated-resumes.routes";
import { errorHandler, notFound } from "./lib/error-handler";
import { checkOrigin } from "./lib/origin-check";
import { locationsRouter } from "./locations/locations.routes";
import { offersRouter } from "./offers/offers.routes";
import { userOffersRouter } from "./offers/user-offers.routes";
import { photosRouter } from "./photos/photos.routes";
import { resumesRouter } from "./resumes/resumes.routes";
import { savedOffersRouter } from "./saved-offers/saved-offers.routes";
import { settingsRouter, templatesRouter } from "./settings/settings.routes";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  // The ingestion endpoint takes batches of up to 100 offers.
  app.use("/api/collector", express.json({ limit: "5mb" }));
  app.use(express.json({ limit: "100kb" }));
  app.use(checkOrigin);
  app.use(loadSession);

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
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
  app.use("/api/templates", templatesRouter);
  app.use("/api/settings", settingsRouter);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
