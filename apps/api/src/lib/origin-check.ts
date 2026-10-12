import type { RequestHandler } from "express";
import { config } from "../config";
import { HttpError } from "./http-error";

const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);

// CSRF protection together with the SameSite=Lax cookie (DATABASE.md "sessions"):
// state-changing requests from a browser must come from one of our own origins.
export const checkOrigin: RequestHandler = (req, _res, next) => {
  const origin = req.headers.origin;
  if (safeMethods.has(req.method) || origin === undefined || config.webOrigins.includes(origin)) {
    return next();
  }
  next(new HttpError(403, "forbidden_origin", "Request origin not allowed"));
};
