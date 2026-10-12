import type { Prisma, PrismaClient } from "@prisma/client";
import { normalizeCatalogueName, type ResumeContent } from "@job/shared";

type Db = PrismaClient | Prisma.TransactionClient;

// Skill & occupation extraction for resumes (FEATURE M2): names from the content are
// normalized and looked up in the catalogue, in the resume language with English as
// fallback. Unknown names are ignored for matching (they stay in the JSON).
export async function extractCatalogueLinks(db: Db, content: ResumeContent, language: string) {
  const skillNames = [
    ...content.skills.map((skill) => skill.name),
    ...content.workExperience.flatMap((job) => job.technologies),
    ...content.projects.flatMap((project) => project.technologies),
  ];
  const occupationNames = [content.basics.title, ...content.workExperience.map((job) => job.jobTitle)].filter(
    (name): name is string => name !== null,
  );
  const languages = [...new Set([language, "en"])];

  const [skills, occupations] = await Promise.all([
    db.skillName.findMany({
      where: { language: { in: languages }, normalizedName: { in: skillNames.map(normalizeCatalogueName) } },
      select: { skillId: true },
    }),
    db.occupationName.findMany({
      where: { language: { in: languages }, normalizedName: { in: occupationNames.map(normalizeCatalogueName) } },
      select: { occupationId: true },
    }),
  ]);

  return {
    skillIds: [...new Set(skills.map((row) => row.skillId))],
    occupationIds: [...new Set(occupations.map((row) => row.occupationId))],
  };
}

// Rewrites the resume's catalogue links; call in the same transaction as the resume save.
export async function syncResumeLinks(db: Db, resumeId: string, content: ResumeContent, language: string) {
  const { skillIds, occupationIds } = await extractCatalogueLinks(db, content, language);
  await db.resumeSkill.deleteMany({ where: { resumeId } });
  await db.resumeOccupation.deleteMany({ where: { resumeId } });
  await db.resumeSkill.createMany({ data: skillIds.map((skillId) => ({ resumeId, skillId })) });
  await db.resumeOccupation.createMany({ data: occupationIds.map((occupationId) => ({ resumeId, occupationId })) });
  return { skillIds, occupationIds };
}
