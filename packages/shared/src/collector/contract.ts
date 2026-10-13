import { z } from "zod";
import { CONTRACT_TYPES, REMOTE_TYPES, SALARY_PERIODS } from "../offers/search";

// Ingestion contract (COLLECTOR.md §4): the one format every source writes to — the
// collector's connectors, POST /api/collector/ingest (bots, browser extension, partners).
// Unknown values are null, never invented; there is no field for personal data.

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
const isoDate = z.iso.datetime({ offset: true });

export const collectedOfferSchema = z.strictObject({
  contractVersion: z.literal(1),
  source: z.string().regex(/^[a-z0-9][a-z0-9-]{1,49}$/), // connector key
  externalId: text(200), // stable id at the source
  url: z.url({ protocol: /^https?$/ }).max(2000).nullable().optional(),
  applyUrl: z.url({ protocol: /^https?$/ }).max(2000).nullable().optional(),
  title: text(300),
  company: z
    .strictObject({
      name: text(300),
      siren: z.string().regex(/^\d{9}$/).nullable().optional(),
      siret: z.string().regex(/^\d{14}$/).nullable().optional(),
      website: z.url({ protocol: /^https?$/ }).max(2000).nullable().optional(),
      logoUrl: z.url({ protocol: /^https?$/ }).max(2000).nullable().optional(),
      atsSlug: optionalText(200),
    })
    .nullable()
    .optional(),
  location: z
    .strictObject({
      raw: optionalText(300),
      city: optionalText(200),
      postcode: optionalText(20),
      countyCode: optionalText(10),
      regionCode: optionalText(20),
      countryCode: z.string().regex(/^[A-Za-z]{2}$/).nullable().optional(),
      latitude: z.number().min(-90).max(90).nullable().optional(),
      longitude: z.number().min(-180).max(180).nullable().optional(),
    })
    .nullable()
    .optional(),
  remote: z.enum(REMOTE_TYPES).nullable().optional(),
  contractType: z.enum(CONTRACT_TYPES).nullable().optional(),
  salary: z
    .strictObject({
      min: z.number().nonnegative().nullable().optional(),
      max: z.number().nonnegative().nullable().optional(),
      currency: z.string().regex(/^[A-Za-z]{3}$/),
      period: z.enum(SALARY_PERIODS),
      raw: optionalText(300),
    })
    .nullable()
    .optional(),
  description: z.strictObject({
    format: z.enum(["markdown", "html", "text"]),
    content: text(100000),
  }),
  language: optionalText(10),
  occupations: z.array(z.strictObject({ scheme: z.enum(["rome", "esco"]), code: text(300), label: optionalText(300) })).max(20).optional(),
  skills: z.array(z.strictObject({ scheme: z.enum(["esco", "rome"]).optional(), code: optionalText(300), label: text(300) })).max(200).optional(),
  experienceLevel: optionalText(200),
  publishedAt: isoDate.nullable().optional(),
  expiresAt: isoDate.nullable().optional(),
  collectedAt: isoDate,
});

export type CollectedOffer = z.output<typeof collectedOfferSchema>;

// POST /api/collector/ingest
export const INGEST_MAX_OFFERS = 100;
export const ingestRequestSchema = z.strictObject({ offers: z.array(z.unknown()).min(1).max(INGEST_MAX_OFFERS) });
export type IngestResult =
  | { index: number; status: "accepted"; source: string; externalId: string }
  | { index: number; status: "rejected"; errors: { path: string; message: string }[] };
export type IngestResponse = { results: IngestResult[] };

// The contract as JSON Schema, for tools written outside this repository (bots, extension).
export function collectedOfferJsonSchema() {
  return z.toJSONSchema(collectedOfferSchema, { io: "input" });
}
