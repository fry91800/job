import { PgBoss } from "pg-boss";
import type { CollectedOffer } from "@job/shared";

// Job queues in PostgreSQL (pg-boss, schema "pgboss"), shared by the API (which sends
// ingested offers) and the job collector (whose worker consumes every queue).

export const QUEUES = {
  run: "collector-run", // { connector }
  ingest: "collector-ingest", // { offers }
  maintenance: "collector-maintenance",
} as const;

export type RunJob = { connector: string };
export type IngestJob = { offers: CollectedOffer[] };

// `sendOnly`: for processes that only send jobs (the API): no maintenance or scheduling,
// which the collector's worker does.
export async function startQueue(databaseUrl = process.env.DATABASE_URL!, { sendOnly = false } = {}): Promise<PgBoss> {
  const boss = new PgBoss({ connectionString: databaseUrl, ...(sendOnly && { supervise: false, schedule: false }) });
  boss.on("error", (error) => console.error("queue error:", error));
  await boss.start();
  for (const name of Object.values(QUEUES)) await boss.createQueue(name);
  return boss;
}
