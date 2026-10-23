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
    // Sandbox accounts hold fake offers: set aside, never collected or re-checked.
    const sandbox = /sandbox$/i.test(board.slug) || /\bsandbox\b/i.test(result.companyName ?? "");
    const status = sandbox ? "paused" : result.jobCount === 0 ? "empty" : result.franceJobCount === 0 ? "no-france" : "active";
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

// What a board's check requests: its own host ("kiloutou.gestmax.fr", "x.wd3.myworkdayjobs.com/…"),
// else the tool's shared API ("workable"); Recruitee answers on each company's own host.
export const hostKey = (board: Pick<CompanySource, "ats" | "slug">) =>
  /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?(\/|$)/i.test(board.slug) ? board.slug.split("/")[0].toLowerCase() : board.ats === "recruitee" ? `${board.slug.toLowerCase()}.recruitee.com` : board.ats;

// Candidates first, then boards whose re-check delay has passed.
export async function checkBoards(options: { ats?: string; limit?: number; concurrency?: number; where?: Prisma.CompanySourceWhereInput; log?: (message: string) => void } = {}) {
  const log = options.log ?? ((message: string) => console.log(`[boards] ${message}`));
  const duplicates = await markDuplicateBoards();
  if (duplicates) log(`${duplicates} duplicate board(s) set aside`);
  const day = 24 * 3600 * 1000;
  const due = Object.entries(collectorConfig.discovery.recheckDays).map(([status, days]) => ({
    status,
    checkedAt: { lt: new Date(Date.now() - days * day) },
  }));
  const scope = { ...options.where, ...(options.ats && { ats: options.ats }) };
  const limit = options.limit ?? 200;
  // Candidates with French-language pages first (discovery marks them ":fr"), then the
  // others and the boards due for a re-check, oldest check first.
  const french = await prisma.companySource.findMany({ where: { ...scope, status: "candidate", discoveredFrom: { endsWith: ":fr" } }, take: limit });
  const rest = await prisma.companySource.findMany({
    where: { ...scope, id: { notIn: french.map((board) => board.id) }, OR: [{ status: "candidate" }, ...due] },
    orderBy: [{ checkedAt: { sort: "asc", nulls: "first" } }],
    take: limit - french.length,
  });
  const boards = [...french, ...rest];
  const counts: Record<string, number> = {};
  // Several boards at a time (`concurrency`), never two on the same host: boards of the
  // tools' shared APIs (Workable, Greenhouse…: slugs without a host) one at a time per tool.
  const waiting = [...boards];
  const busy = new Set<string>();
  const worker = async () => {
    for (;;) {
      const index = waiting.findIndex((board) => !busy.has(hostKey(board)));
      if (index === -1) {
        if (!waiting.length) return;
        await pause(200);
        continue;
      }
      const [board] = waiting.splice(index, 1);
      busy.add(hostKey(board));
      try {
        const result = await checkBoard(board);
        counts[result.status] = (counts[result.status] ?? 0) + 1;
        if (result.status === "active") log(`${board.ats}/${board.slug}: active (${result.franceJobCount} of ${result.jobCount} offers in France)`);
        await pause(collectorConfig.ats.pauseBetweenBoardsMs);
      } finally {
        busy.delete(hostKey(board));
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, options.concurrency ?? 1) }, worker));
  log(`checked ${boards.length} board(s): ${JSON.stringify(counts)}`);
  return counts;
}
