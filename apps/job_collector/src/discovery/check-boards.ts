import { prisma } from "@job/backend";
import type { CompanySource, Prisma } from "@prisma/client";
import { NotFoundError, pause } from "../ats/http";
import { nameFromSlug } from "../ats/mapping";
import { findAdapter } from "../ats/registry";
import { collectorConfig } from "../config";
import { findOrCreateCompany } from "../pipeline/companies";
import { normalizeCompanyName } from "../pipeline/text";

// Checks boards: does it exist, how many offers, how many in France? Boards with French
// offers become active (collected); the others are checked again later (recheckDays).

export type CheckResult = { status: string; jobCount: number | null; franceJobCount: number | null };

export async function checkBoard(board: CompanySource): Promise<CheckResult> {
  const adapter = findAdapter(board.ats);
  if (!adapter) throw new Error(`No adapter for ${board.ats}`);
  try {
    const result = await adapter.check(board.slug);
    const status = result.jobCount === 0 ? "empty" : result.franceJobCount === 0 ? "no-france" : "active";
    let companyId = board.companyId;
    if (status === "active" && !companyId) {
      const name = result.companyName ?? nameFromSlug(board.slug);
      companyId = (await findOrCreateCompany({ name, normalizedName: normalizeCompanyName(name), siren: null, website: null })).id;
    }
    await prisma.companySource.update({
      where: { id: board.id },
      data: { status, jobCount: result.jobCount, franceJobCount: result.franceJobCount, checkedAt: new Date(), companyId, lastError: null },
    });
    return { status, jobCount: result.jobCount, franceJobCount: result.franceJobCount };
  } catch (error) {
    const gone = error instanceof NotFoundError;
    await prisma.companySource.update({
      where: { id: board.id },
      data: { checkedAt: new Date(), lastError: String(error instanceof Error ? error.message : error).slice(0, 500), ...(gone && { status: "invalid" }) },
    });
    return { status: gone ? "invalid" : board.status, jobCount: null, franceJobCount: null };
  }
}

// Boards whose ids only differ by letter case are the same board: one is kept (active
// first, then the oldest), the others become "duplicate" and are no longer collected.
export async function markDuplicateBoards(): Promise<number> {
  return prisma.$executeRaw`
    UPDATE company_sources s SET status = 'duplicate'
    FROM (
      SELECT id, row_number() OVER (
        PARTITION BY ats, lower(slug) ORDER BY (status = 'active') DESC, created_at, id
      ) AS position
      FROM company_sources
    ) ranked
    WHERE s.id = ranked.id AND ranked.position > 1 AND s.status <> 'duplicate'`;
}

// Candidates first, then boards whose re-check delay has passed.
export async function checkBoards(options: { ats?: string; limit?: number; where?: Prisma.CompanySourceWhereInput; log?: (message: string) => void } = {}) {
  const log = options.log ?? ((message: string) => console.log(`[boards] ${message}`));
  const duplicates = await markDuplicateBoards();
  if (duplicates) log(`${duplicates} duplicate board(s) set aside`);
  const day = 24 * 3600 * 1000;
  const due = Object.entries(collectorConfig.discovery.recheckDays).map(([status, days]) => ({
    status,
    checkedAt: { lt: new Date(Date.now() - days * day) },
  }));
  const boards = await prisma.companySource.findMany({
    where: { ...options.where, ...(options.ats && { ats: options.ats }), OR: [{ status: "candidate" }, ...due] },
    orderBy: [{ checkedAt: { sort: "asc", nulls: "first" } }],
    take: options.limit ?? 200,
  });
  const counts: Record<string, number> = {};
  for (const board of boards) {
    const result = await checkBoard(board);
    counts[result.status] = (counts[result.status] ?? 0) + 1;
    if (result.status === "active") log(`${board.ats}/${board.slug}: active (${result.franceJobCount} of ${result.jobCount} offers in France)`);
    await pause(collectorConfig.ats.pauseBetweenBoardsMs);
  }
  log(`checked ${boards.length} board(s): ${JSON.stringify(counts)}`);
  return counts;
}
