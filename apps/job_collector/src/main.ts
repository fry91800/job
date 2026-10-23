// The collector worker: schedules the connectors, runs them, and processes the offers
// sent by the API's ingestion endpoint. `npm run collector:start`.
import { logEvent, prisma, QUEUES, sendAlert, startQueue, type BoardsJob, type BotPagesJob, type BotSnapshotJob, type IngestJob, type RunJob } from "@job/backend";
import { atsAdapters } from "./ats/registry";
import { checkBoards } from "./discovery/check-boards";
import { discoverBoards } from "./discovery/common-crawl";
import { collectorConfig } from "./config";
import { connectors, findConnector } from "./connectors/registry";
import { runMaintenance } from "./pipeline/close";
import { processRecord } from "./pipeline/process";
import { checkBotSources } from "./bots/health";
import { processBotPages } from "./bots/pages";
import { applySnapshot } from "./bots/snapshot";
import { runConnector } from "./runs/run-connector";

// Settings a production worker must have (DEPLOYMENT.md); Geoapify places the offers.
function productionProblems(env: NodeJS.ProcessEnv): string[] {
  return ["DATABASE_URL", "CRAWLER_CONTACT_URL", "CRAWLER_CONTACT_EMAIL", "GEOAPIFY_API_KEY"].filter((name) => !env[name]?.trim()).map((name) => `${name} is missing`);
}

// A failed background job (discovery, board checks, maintenance) alerts someone.
async function alerting(name: string, task: () => Promise<unknown>) {
  try {
    await task();
  } catch (error) {
    await sendAlert(`job:${name}`, `Collector job "${name}" failed: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

async function main() {
  if (process.env.NODE_ENV === "production") {
    const problems = productionProblems(process.env);
    if (problems.length) {
      for (const problem of problems) logEvent("error", "config_problem", { problem });
      process.exit(1);
    }
  }
  const boss = await startQueue(collectorConfig.databaseUrl);

  // One run at a time per connector: scheduled runs of the same connector wait.
  await boss.work<RunJob>(QUEUES.run, async ([job]) => {
    const connector = findConnector(job.data.connector);
    if (!connector) throw new Error(`Unknown connector ${job.data.connector}`);
    await runConnector(connector);
  });

  // Offers from POST /api/collector/ingest (already validated by the API).
  await boss.work<IngestJob>(QUEUES.ingest, async (jobs) => {
    for (const job of jobs) {
      for (const offer of job.data.offers) {
        const outcome = await processRecord({ raw: offer, offer });
        if (outcome.result === "rejected") console.warn(`[ingest] rejected ${offer.source}/${offer.externalId}: ${outcome.reason}`);
      }
    }
  });

  // Company discovery and board checks (COLLECTOR.md §5.2).
  await boss.work<BoardsJob>(QUEUES.boards, async ([job]) =>
    alerting(job.data.action === "discover" ? "discovery" : "board checks", async () => {
      if (job.data.action === "discover") {
        for (const adapter of atsAdapters.filter((item) => item.discovery)) await discoverBoards(adapter);
      } else {
        await checkBoards({ limit: collectorConfig.discovery.checkBatch, concurrency: collectorConfig.discovery.checkConcurrency });
      }
    }),
  );

  // Bots (COLLECTOR.md §17.2–17.3): pages to extract, snapshots to apply.
  await boss.work<BotPagesJob>(QUEUES.pages, async ([job]) =>
    alerting("bot pages", async () => logEvent("info", "bot_pages", { source: job.data.source, ...(await processBotPages(job.data.source, job.data.pages)) })),
  );
  await boss.work<BotSnapshotJob>(QUEUES.snapshot, async ([job]) =>
    alerting("bot snapshot", async () => logEvent("info", "bot_snapshot", { source: job.data.source, scope: job.data.snapshot.scope, ...(await applySnapshot(job.data.source, job.data.snapshot)) })),
  );

  await boss.work(QUEUES.maintenance, async () =>
    alerting("maintenance", async () => logEvent("info", "maintenance", { ...(await checkBotSources()), ...(await runMaintenance()) })),
  );

  for (const connector of connectors) {
    if (connector.schedule) await boss.schedule(QUEUES.run, connector.schedule, { connector: connector.key }, { key: connector.key });
    else await boss.unschedule(QUEUES.run, connector.key);
  }
  await boss.schedule(QUEUES.maintenance, collectorConfig.maintenanceCron, {}, { key: "daily" });
  await boss.schedule(QUEUES.boards, collectorConfig.discovery.checkCron, { action: "check" }, { key: "check" });
  await boss.schedule(QUEUES.boards, collectorConfig.discovery.discoverCron, { action: "discover" }, { key: "discover" });

  logEvent("info", "collector_started", { scheduledConnectors: connectors.filter((connector) => connector.schedule).length });

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, async () => {
      await boss.stop({ graceful: true });
      await prisma.$disconnect();
      process.exit(0);
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
