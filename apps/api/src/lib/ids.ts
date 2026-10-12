import { randomBytes } from "node:crypto";
import { z } from "zod";
import { HttpError } from "./http-error";

// Row ids are UUIDs: anything else cannot exist, so it is a 404 like an unknown id.
export function parseUuid(value: unknown, notFound: () => HttpError): string {
  const result = z.uuid().safeParse(value);
  if (!result.success) throw notFound();
  return result.data;
}

// Short random id for items inside resume JSON (DATABASE.md "Item ids").
export function newItemId(): string {
  return randomBytes(6).toString("base64url");
}
