import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { prisma } from "@job/backend";
import { exportBoards, importBoards } from "./registry-file";

// Only boards whose slug starts with "test-registry-" are exported, changed and removed.

const TEST = { slug: { startsWith: "test-registry-" } };
let dir: string;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "registry-test-"));
  const company = await prisma.company.create({ data: { name: "Test Registry SAS", normalizedName: "test registry" } });
  await prisma.companySource.createMany({
    data: [
      { ats: "greenhouse", slug: "test-registry-active", status: "active", companyId: company.id, franceJobCount: 12, checkedAt: new Date("2026-10-10T00:00:00Z"), discoveredFrom: "commoncrawl:CC-TEST" },
      { ats: "ashby", slug: "test-registry-abroad", status: "no-france", checkedAt: new Date("2026-10-10T00:00:00Z") },
    ],
  });
});

after(async () => {
  await prisma.companySource.deleteMany({ where: TEST });
  await prisma.company.deleteMany({ where: { normalizedName: "test registry" } });
  await rm(dir, { recursive: true, force: true });
  await prisma.$disconnect();
});

describe("board registry file", () => {
  test("export then import into an empty registry recreates the boards and their company", async () => {
    const file = join(dir, "boards.json.gz");
    assert.equal(await exportBoards(file, TEST), 2);
    await prisma.companySource.deleteMany({ where: TEST });
    await prisma.company.deleteMany({ where: { normalizedName: "test registry" } });

    assert.deepEqual(await importBoards(file), { created: 2, updated: 0, kept: 0 });
    const active = await prisma.companySource.findUniqueOrThrow({ where: { ats_slug: { ats: "greenhouse", slug: "test-registry-active" } }, include: { company: true } });
    assert.deepEqual(
      [active.status, active.franceJobCount, active.discoveredFrom, active.checkedAt?.toISOString(), active.company?.name],
      ["active", 12, "commoncrawl:CC-TEST", "2026-10-10T00:00:00.000Z", "Test Registry SAS"],
    );
  });

  test("a board checked more recently in the database is kept; an older one is updated", async () => {
    const file = join(dir, "boards.json");
    await exportBoards(file, TEST);
    await prisma.companySource.update({ where: { ats_slug: { ats: "greenhouse", slug: "test-registry-active" } }, data: { status: "empty", checkedAt: new Date("2026-10-12T00:00:00Z") } });
    await prisma.companySource.update({ where: { ats_slug: { ats: "ashby", slug: "test-registry-abroad" } }, data: { status: "candidate", checkedAt: null } });

    assert.deepEqual(await importBoards(file), { created: 0, updated: 1, kept: 1 });
    const rows = await prisma.companySource.findMany({ where: TEST, orderBy: { slug: "asc" } });
    assert.deepEqual(rows.map((row) => [row.slug, row.status]), [["test-registry-abroad", "no-france"], ["test-registry-active", "empty"]]);
  });
});
