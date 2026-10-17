import { prisma } from "@job/backend";
import type { Prisma } from "@prisma/client";
import { collectorConfig } from "../config";
import type { CollectedRecord, Connector } from "../connectors/types";
import { closeSource, markSeen } from "../pipeline/close";
import type { AtsAdapter, KnownOffers } from "./adapter";
import { NotFoundError, pause } from "./http";
import { nameFromSlug } from "./mapping";

// A connector per recruiting tool: collects every active board of that tool. Each board is
// a full sync: once all its French offers were read, the board's offers that are no
// longer there are closed. A board that fails is left as it was (nothing closed).

export async function closeMissingOffers(source: string, slug: string, seen: Set<string>): Promise<number> {
  const open = await prisma.offerSource.findMany({
    where: { source, externalId: { startsWith: `${slug}:` }, closedAt: null },
    select: { externalId: true },
  });
  let closed = 0;
  for (const row of open) {
    if (!seen.has(row.externalId)) {
      await closeSource(source, row.externalId);
      closed++;
    }
  }
  return closed;
}

// The board's offers already received, with the release date of their latest raw record
// (SmartRecruiters skips their detail request when it hasn't changed).
async function knownOffers(source: string, slug: string): Promise<KnownOffers> {
  const prefix = `${slug}:`;
  const rows = await prisma.$queryRaw<{ external_id: string; released: string | null }[]>`
    SELECT DISTINCT ON (r.external_id) r.external_id, r.payload->>'releasedDate' AS released
    FROM raw_offers r
    JOIN offer_sources s ON s.source = r.source AND s.external_id = r.external_id
    WHERE r.source = ${source} AND left(r.external_id, ${prefix.length}) = ${prefix}
    ORDER BY r.external_id, r.received_at DESC`;
  return new Map(rows.map((row) => [row.external_id, row.released]));
}

// `where` narrows the boards and `key` renames the runs (tests use their own boards and
// run records only).
export function atsConnector(adapter: AtsAdapter, options: { where?: Prisma.CompanySourceWhereInput; key?: string } = {}): Connector {
  return {
    key: options.key ?? adapter.ats,
    kind: adapter.kind ?? "ats",
    description: `${adapter.ats} job boards (active boards of the company registry)`,
    schedule: adapter.schedule ?? collectorConfig.ats.schedule,
    async *collect(context): AsyncGenerator<CollectedRecord, string | null> {
      const boards = await prisma.companySource.findMany({
        where: { ...options.where, ats: adapter.ats, status: "active" },
        include: { company: { select: { name: true } } },
        orderBy: [{ lastRunAt: { sort: "asc", nulls: "first" } }],
      });
      context.log(`${boards.length} active board(s)`);
      let skipped = 0;

      for (const board of boards) {
        if (context.signal.aborted) break;
        const seen = new Set<string>();
        const stillListed: string[] = [];
        let partial = false;
        try {
          const known = await knownOffers(adapter.ats, board.slug);
          for await (const record of adapter.collect(board.slug, board.company?.name ?? nameFromSlug(board.slug), known)) {
            if ("partialListing" in record) {
              partial = true;
              continue;
            }
            if ("stillListed" in record) {
              seen.add(record.stillListed);
              stillListed.push(record.stillListed);
              continue;
            }
            seen.add(record.offer.externalId);
            yield record;
          }
          await markSeen(adapter.ats, stillListed);
          skipped += stillListed.length;
          // A partial listing closes nothing and says nothing about the board's size.
          const closed = partial ? 0 : await closeMissingOffers(adapter.ats, board.slug, seen);
          await prisma.companySource.update({
            where: { id: board.id },
            data: partial
              ? { lastRunAt: new Date(), lastError: null }
              : { lastRunAt: new Date(), franceJobCount: seen.size, status: seen.size > 0 ? "active" : "no-france", lastError: null },
          });
          if (closed) context.log(`${board.slug}: ${closed} offer(s) closed`);
        } catch (error) {
          // A board that no longer exists stops being collected; other errors are retried
          // at the next run. In both cases nothing is closed.
          const gone = error instanceof NotFoundError;
          await prisma.companySource.update({
            where: { id: board.id },
            data: { lastRunAt: new Date(), lastError: String(error instanceof Error ? error.message : error).slice(0, 500), ...(gone && { status: "invalid" }) },
          });
          context.log(`${board.slug}: ${gone ? "board not found, marked invalid" : `failed (${error instanceof Error ? error.message : error})`}`);
        }
        await pause(collectorConfig.ats.pauseBetweenBoardsMs);
      }
      if (skipped) context.log(`${skipped} known offer(s) still listed, details not fetched again`);
      return null;
    },
  };
}
