import { prisma } from "@job/backend";
import type { NormalizedOffer } from "./normalize";

// The company of a collected offer: by SIREN when the source gives it, else by
// normalized name; created when unknown (COLLECTOR.md §7, FEATURE C1).
export async function findOrCreateCompany(company: NonNullable<NormalizedOffer["company"]>): Promise<{ id: string; key: string }> {
  if (company.siren) {
    const bySiren = await prisma.company.findUnique({ where: { siren: company.siren } });
    if (bySiren) return { id: bySiren.id, key: company.siren };
    // A company first seen without SIREN gets it now.
    const byName = await prisma.company.findFirst({ where: { normalizedName: company.normalizedName, siren: null } });
    if (byName) {
      await prisma.company.update({ where: { id: byName.id }, data: { siren: company.siren } });
      return { id: byName.id, key: company.siren };
    }
    const created = await prisma.company.create({
      data: { name: company.name, normalizedName: company.normalizedName, siren: company.siren, website: company.website },
    });
    return { id: created.id, key: company.siren };
  }

  const existing = await prisma.company.findFirst({ where: { normalizedName: company.normalizedName }, orderBy: { createdAt: "asc" } });
  if (existing) return { id: existing.id, key: existing.siren ?? company.normalizedName };
  const created = await prisma.company.create({ data: { name: company.name, normalizedName: company.normalizedName, website: company.website } });
  return { id: created.id, key: company.normalizedName };
}
