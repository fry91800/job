import { PgBoss } from "pg-boss";
import type { CollectedOffer } from "@job/shared";

// Job queues in PostgreSQL (pg-boss, schema "pgboss"), shared by the API (which sends
// ingested offers) and the job collector (whose worker consumes every queue).

export const QUEUES = {
  run: "collector-run", // { connector }
  ingest: "collector-ingest", // { offers }
  maintenance: "collector-maintenance",
  boards: "collector-boards", // { action: "discover" | "check" }
} as const;

// A connector run or a discovery can take hours (the default expiry, 15 minutes, would
// start a second copy). A failed run isn't retried: the next scheduled one follows.
const LONG = { expireInSeconds: 6 * 3600, retryLimit: 0 };
const QUEUE_OPTIONS: Record<string, { expireInSeconds?: number; retryLimit?: number }> = {
  [QUEUES.run]: LONG,
  [QUEUES.ingest]: {},
  [QUEUES.maintenance]: { expireInSeconds: 3600 },
  [QUEUES.boards]: LONG,
};

export type RunJob = { connector: string };
export type IngestJob = { offers: CollectedOffer[] };
export type BoardsJob = { action: "discover" | "check" };

// `sendOnly`: for processes that only send jobs (the API): no maintenance or scheduling,
// which the collector's worker does.
export async function startQueue(databaseUrl = process.env.DATABASE_URL!, { sendOnly = false } = {}): Promise<PgBoss> {
  const boss = new PgBoss({ connectionString: databaseUrl, ...(sendOnly && { supervise: false, schedule: false }) });
  boss.on("error", (error) => console.error("queue error:", error));
  await boss.start();
  for (const [name, options] of Object.entries(QUEUE_OPTIONS)) {
    if (!(await boss.getQueue(name))) await boss.createQueue(name, options);
    else if (Object.keys(options).length > 0) await boss.updateQueue(name, options);
  }
  return boss;
}
