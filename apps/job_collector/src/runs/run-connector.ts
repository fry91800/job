import { prisma, sendAlert } from "@job/backend";
import type { Prisma } from "@prisma/client";
import type { Connector } from "../connectors/types";
import { processRecord } from "../pipeline/process";

// Runs a connector once: records the run, sends every record through the pipeline,
// counts the outcomes, and keeps the cursor for the next incremental run.

export type RunCounts = Record<"received" | "created" | "updated" | "merged" | "unchanged" | "rejected" | "failed", number>;

export async function runConnector(connector: Connector, options: { signal?: AbortSignal; log?: (message: string) => void } = {}) {
  const log = options.log ?? ((message: string) => console.log(`[${connector.key}] ${message}`));
  // A run whose process was stopped (deploy, crash, timeout) stays "running": the next
  // run of the same connector closes it as interrupted.
  await prisma.collectorRun.updateMany({
    where: { connector: connector.key, status: "running" },
    data: { status: "failed", finishedAt: new Date(), error: "interrupted (the process stopped before the end)" },
  });
  const previous = await prisma.collectorRun.findFirst({
    where: { connector: connector.key, status: "succeeded" },
    orderBy: { startedAt: "desc" },
    select: { cursor: true },
  });
  const run = await prisma.collectorRun.create({ data: { connector: connector.key, status: "running", cursor: previous?.cursor ?? null } });
  const counts: RunCounts = { received: 0, created: 0, updated: 0, merged: 0, unchanged: 0, rejected: 0, failed: 0 };

  try {
    const iterator = connector.collect({ cursor: previous?.cursor ?? null, signal: options.signal ?? new AbortController().signal, log });
    let step = await iterator.next();
    while (!step.done) {
      counts.received++;
      try {
        const outcome = await processRecord(step.value);
        counts[outcome.result]++;
        if (outcome.result === "rejected") log(`rejected ${step.value.offer?.externalId}: ${outcome.reason}`);
      } catch (error) {
        // One bad record doesn't stop the run.
        counts.failed++;
        log(`failed ${step.value.offer?.externalId}: ${error instanceof Error ? error.message : error}`);
      }
      step = await iterator.next();
    }
    await prisma.collectorRun.update({
      where: { id: run.id },
      data: { status: "succeeded", finishedAt: new Date(), cursor: step.value ?? previous?.cursor ?? null, counts: counts as Prisma.InputJsonValue },
    });
    log(`done: ${JSON.stringify(counts)}`);
  } catch (error) {
    await prisma.collectorRun.update({
      where: { id: run.id },
      data: { status: "failed", finishedAt: new Date(), counts: counts as Prisma.InputJsonValue, error: error instanceof Error ? error.message : String(error) },
    });
    await sendAlert(`run:${connector.key}`, `Collection run "${connector.key}" failed after ${counts.received} record(s): ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
  return { runId: run.id, counts };
}
