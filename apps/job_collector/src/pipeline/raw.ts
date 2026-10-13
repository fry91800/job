import { createHash } from "node:crypto";
import { prisma } from "@job/backend";
import type { Prisma } from "@prisma/client";

// Stage 1 (COLLECTOR.md §6): the record as received. A row is added only when the content
// changed, so unchanged records can skip the rest of the pipeline.

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export async function storeRaw(source: string, externalId: string, payload: unknown): Promise<{ changed: boolean }> {
  const contentHash = createHash("sha256").update(stableJson(payload)).digest("hex");
  const result = await prisma.rawOffer.createMany({
    data: [{ source, externalId, contentHash, payload: payload as Prisma.InputJsonValue }],
    skipDuplicates: true,
  });
  return { changed: result.count > 0 };
}
