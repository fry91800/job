import type { ErrorRequestHandler, RequestHandler } from "express";
import { errorFields, logEvent, sendAlert } from "@job/backend";
import { ZodError } from "zod";
import { HttpError } from "./http-error";

export const notFound: RequestHandler = (_req, res) => {
  res.status(404).json({ error: { code: "not_found", message: "Route not found" } });
};

export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  if (error instanceof ZodError) {
    res.status(400).json({
      error: {
        code: "invalid_request",
        message: "Invalid request parameters",
        issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      },
    });
    return;
  }
  // Body parser errors (invalid JSON, body too large…) carry their own status.
  if (typeof error?.status === "number" && error.status < 500 && typeof error.type === "string") {
    const code = error.type === "entity.too.large" ? "payload_too_large" : error.type === "entity.parse.failed" ? "invalid_json" : "invalid_request";
    res.status(error.status).json({ error: { code, message: error.message } });
    return;
  }
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: { code: error.code, message: error.message, ...(error.details !== undefined && { details: error.details }) } });
    return;
  }
  logEvent("error", "internal_error", { id: req.requestId, method: req.method, path: req.path, ...errorFields(error) });
  void sendAlert("api-internal-error", `API error on ${req.method} ${req.baseUrl}${req.route?.path ?? ""}: ${error instanceof Error ? error.message : String(error)} (request ${req.requestId})`);
  res.status(500).json({ error: { code: "internal_error", message: "Internal server error" } });
};
