// The collector worker: schedules the connectors, runs them, and processes the offers
// sent by the API's ingestion endpoint. `npm run collector:start`.
import { prisma, QUEUES, startQueue, type BoardsJob, type IngestJob, type RunJob } from "@job/backend";
import { atsAdapters } from "./ats/registry";
import { checkBoards } from "./discovery/check-boards";
import { discoverBoards } from "./discovery/common-crawl";
import { collectorConfig } from "./config";
import { connectors, findConnector } from "./connectors/registry";
import { runMaintenance } from "./pipeline/close";
import { processRecord } from "./pipeline/process";
import { runConnector } from "./runs/run-connector";

async function main() {
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
  await boss.work<BoardsJob>(QUEUES.boards, async ([job]) => {
    if (job.data.action === "discover") {
      for (const adapter of atsAdapters.filter((item) => item.discovery)) await discoverBoards(adapter);
    } else {
      await checkBoards({ limit: collectorConfig.discovery.checkBatch });
    }
  });

  await boss.work(QUEUES.maintenance, async () => {
    console.log("[maintenance]", JSON.stringify(await runMaintenance()));
  });

  for (const connector of connectors) {
    if (connector.schedule) await boss.schedule(QUEUES.run, connector.schedule, { connector: connector.key }, { key: connector.key });
    else await boss.unschedule(QUEUES.run, connector.key);
  }
  await boss.schedule(QUEUES.maintenance, collectorConfig.maintenanceCron, {}, { key: "daily" });
  await boss.schedule(QUEUES.boards, collectorConfig.discovery.checkCron, { action: "check" }, { key: "check" });
  await boss.schedule(QUEUES.boards, collectorConfig.discovery.discoverCron, { action: "discover" }, { key: "discover" });

  console.log(`collector started: ${connectors.filter((connector) => connector.schedule).length} scheduled connector(s)`);

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
