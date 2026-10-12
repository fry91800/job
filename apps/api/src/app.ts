import express from "express";
import { authRouter } from "./auth/auth.routes";
import { loadSession } from "./auth/session";
import { errorHandler, notFound } from "./lib/error-handler";
import { checkOrigin } from "./lib/origin-check";
import { locationsRouter } from "./locations/locations.routes";
import { offersRouter } from "./offers/offers.routes";
import { savedOffersRouter } from "./saved-offers/saved-offers.routes";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "100kb" }));
  app.use(checkOrigin);
  app.use(loadSession);

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });
  app.use("/api/auth", authRouter);
  app.use("/api/locations", locationsRouter);
  app.use("/api/offers", offersRouter);
  app.use("/api/saved-offers", savedOffersRouter);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
