import { prisma } from "@job/backend";
import type { Prisma } from "@prisma/client";
import { collectorConfig } from "../config";
import type { CollectedRecord, Connector } from "../connectors/types";
import { closeSource } from "../pipeline/close";
import type { AtsAdapter } from "./adapter";
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

// `where` narrows the boards and `key` renames the runs (tests use their own boards and
// run records only).
export function atsConnector(adapter: AtsAdapter, options: { where?: Prisma.CompanySourceWhereInput; key?: string } = {}): Connector {
  return {
    key: options.key ?? adapter.ats,
    kind: "ats",
    description: `${adapter.ats} job boards (active boards of the company registry)`,
    schedule: collectorConfig.ats.schedule,
    async *collect(context): AsyncGenerator<CollectedRecord, string | null> {
      const boards = await prisma.companySource.findMany({
        where: { ...options.where, ats: adapter.ats, status: "active" },
        include: { company: { select: { name: true } } },
        orderBy: [{ lastRunAt: { sort: "asc", nulls: "first" } }],
      });
      context.log(`${boards.length} active board(s)`);

      for (const board of boards) {
        if (context.signal.aborted) break;
        const seen = new Set<string>();
        try {
          for await (const record of adapter.collect(board.slug, board.company?.name ?? nameFromSlug(board.slug))) {
            seen.add(record.offer.externalId);
            yield record;
          }
          const closed = await closeMissingOffers(adapter.ats, board.slug, seen);
          await prisma.companySource.update({
            where: { id: board.id },
            data: { lastRunAt: new Date(), franceJobCount: seen.size, status: seen.size > 0 ? "active" : "no-france", lastError: null },
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
      return null;
    },
  };
}
