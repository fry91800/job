import { readFile, writeFile } from "node:fs/promises";
import { gunzipSync, gzipSync } from "node:zlib";
import { prisma } from "@job/backend";
import type { Prisma } from "@prisma/client";
import { findOrCreateCompany } from "../pipeline/companies";

// The board registry (company_sources and their companies) saved to a file and merged
// back into a database: carries discovery and check results to another database
// (production) or across a development reset. Offers aren't included: the first
// collection run brings them back. Files ending in .gz are gzipped.

const VERSION = 1;

type BoardRow = {
  ats: string;
  slug: string;
  status: string;
  discoveredFrom: string | null;
  jobCount: number | null;
  franceJobCount: number | null;
  checkedAt: string | null;
  lastRunAt: string | null;
  lastError: string | null;
  createdAt: string;
  company: { name: string; normalizedName: string; siren: string | null; website: string | null } | null;
};
type RegistryFile = { version: number; exportedAt: string; boards: BoardRow[] };

const iso = (date: Date | null) => date?.toISOString() ?? null;
const date = (value: string | null) => (value ? new Date(value) : null);

export async function exportBoards(path: string, where: Prisma.CompanySourceWhereInput = {}): Promise<number> {
  const rows = await prisma.companySource.findMany({ where, include: { company: true }, orderBy: [{ ats: "asc" }, { slug: "asc" }] });
  const file: RegistryFile = {
    version: VERSION,
    exportedAt: new Date().toISOString(),
    boards: rows.map((row) => ({
      ats: row.ats,
      slug: row.slug,
      status: row.status,
      discoveredFrom: row.discoveredFrom,
      jobCount: row.jobCount,
      franceJobCount: row.franceJobCount,
      checkedAt: iso(row.checkedAt),
      lastRunAt: iso(row.lastRunAt),
      lastError: row.lastError,
      createdAt: row.createdAt.toISOString(),
      company: row.company && { name: row.company.name, normalizedName: row.company.normalizedName, siren: row.company.siren, website: row.company.website },
    })),
  };
  const json = JSON.stringify(file);
  await writeFile(path, path.endsWith(".gz") ? gzipSync(json) : json);
  return rows.length;
}

// Boards missing from the database are added; a board present on both sides takes the
// file's values only when the file checked it more recently.
export async function importBoards(path: string): Promise<{ created: number; updated: number; kept: number }> {
  const content = await readFile(path);
  const file = JSON.parse((path.endsWith(".gz") ? gunzipSync(content) : content).toString("utf8")) as RegistryFile;
  if (file.version !== VERSION || !Array.isArray(file.boards)) throw new Error(`Unsupported board file (version ${file.version})`);

  const counts = { created: 0, updated: 0, kept: 0 };
  for (const board of file.boards) {
    const existing = await prisma.companySource.findUnique({ where: { ats_slug: { ats: board.ats, slug: board.slug } } });
    const newer = !existing || (board.checkedAt !== null && (existing.checkedAt === null || new Date(board.checkedAt) > existing.checkedAt));
    if (!newer) {
      counts.kept++;
      continue;
    }
    const companyId = board.company ? (await findOrCreateCompany(board.company)).id : (existing?.companyId ?? null);
    const data = {
      companyId,
      status: board.status,
      discoveredFrom: board.discoveredFrom,
      jobCount: board.jobCount,
      franceJobCount: board.franceJobCount,
      checkedAt: date(board.checkedAt),
      lastRunAt: date(board.lastRunAt),
      lastError: board.lastError,
    };
    if (existing) {
      await prisma.companySource.update({ where: { id: existing.id }, data });
      counts.updated++;
    } else {
      await prisma.companySource.create({ data: { ...data, ats: board.ats, slug: board.slug, createdAt: new Date(board.createdAt) } });
      counts.created++;
    }
  }
  return counts;
}
