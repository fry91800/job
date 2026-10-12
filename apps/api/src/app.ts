import express from "express";
import { loadSession } from "./auth/session";
import { errorHandler, notFound } from "./lib/error-handler";
import { offersRouter } from "./offers/offers.routes";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json());
  app.use(loadSession);

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });
  app.use("/api/offers", offersRouter);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
