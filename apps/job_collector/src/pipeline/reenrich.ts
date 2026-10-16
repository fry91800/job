import { canonicalIds, matchInText, prisma } from "@job/backend";
import { resolveOccupations } from "./enrich";
import { qualityScore } from "./text";

// Recomputes the catalogue links of stored offers from their title and description, after
// the matching rules or the catalogue changed (`npm run collector -- reenrich`):
// occupations, skills and the quality score (which counts skills). Collected and
// user-added offers are recomputed; no source gives skill labels yet, so nothing is lost.
// Resumes keep their skills, mapped to the ids that stand for them (the same skill in two
// catalogues counts once). No network: only the catalogue and the rules.

type Counts = { offers: number; changed: number; resumes: number };

const sameSet = (a: number[], b: number[]) => a.length === b.length && a.every((id) => b.includes(id));

export async function reenrich(options: { log?: (message: string) => void } = {}): Promise<Counts> {
  const log = options.log ?? ((message: string) => console.log(`[reenrich] ${message}`));
  let cursor: string | undefined;
  const counts: Counts = { offers: 0, changed: 0, resumes: 0 };
  for (;;) {
    const batch = await prisma.offer.findMany({
      where: { OR: [{ sources: { some: {} } }, { source: "user" }] },
      select: {
        id: true, title: true, description: true, language: true, companyName: true, locationId: true, contractType: true, remoteType: true,
        salaryMin: true, salaryMax: true, publishedAt: true, qualityScore: true,
        occupations: { select: { occupationId: true } },
        skills: { select: { skillId: true } },
      },
      orderBy: { id: "asc" },
      take: 500,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
    });
    if (batch.length === 0) break;
    for (const offer of batch) {
      const [occupationIds, fromTitle, fromText] = await Promise.all([
        resolveOccupations({ title: offer.title, occupations: [] }, offer.language),
        matchInText("skill", offer.title, offer.language, { title: true }),
        matchInText("skill", offer.description, offer.language),
      ]);
      const skillIds = [...new Set([...fromTitle, ...fromText])];
      const score = qualityScore({
        hasSalary: offer.salaryMin !== null || offer.salaryMax !== null,
        hasLocation: offer.locationId !== null,
        hasContract: offer.contractType !== null,
        hasRemote: offer.remoteType !== null,
        hasCompany: offer.companyName !== null,
        skillCount: skillIds.length,
        descriptionLength: offer.description.length,
        hasPublishedAt: offer.publishedAt !== null,
      });
      const sameOccupations = sameSet(occupationIds, offer.occupations.map((row) => row.occupationId));
      const sameSkills = sameSet(skillIds, offer.skills.map((row) => row.skillId));
      if (sameOccupations && sameSkills && score === offer.qualityScore) continue;
      await prisma.$transaction([
        prisma.offerOccupation.deleteMany({ where: { offerId: offer.id } }),
        prisma.offerOccupation.createMany({ data: occupationIds.map((occupationId) => ({ offerId: offer.id, occupationId })) }),
        prisma.offerSkill.deleteMany({ where: { offerId: offer.id } }),
        prisma.offerSkill.createMany({ data: skillIds.map((skillId) => ({ offerId: offer.id, skillId })) }),
        prisma.offer.update({ where: { id: offer.id }, data: { qualityScore: score } }),
      ]);
      counts.changed++;
    }
    counts.offers += batch.length;
    cursor = batch[batch.length - 1].id;
    if (counts.offers % 5000 < 500) log(`${counts.offers} offers, ${counts.changed} changed`);
  }

  const resumes = await prisma.resume.findMany({ select: { id: true, skills: { select: { skillId: true } } } });
  for (const resume of resumes) {
    const current = resume.skills.map((row) => row.skillId);
    const ids = await canonicalIds("skill", current);
    if (sameSet(ids, current)) continue;
    await prisma.$transaction([
      prisma.resumeSkill.deleteMany({ where: { resumeId: resume.id } }),
      prisma.resumeSkill.createMany({ data: ids.map((skillId) => ({ resumeId: resume.id, skillId })) }),
    ]);
    counts.resumes++;
  }
  log(`done: ${counts.offers} offers, ${counts.changed} changed; ${counts.resumes} resume(s) updated`);
  return counts;
}
