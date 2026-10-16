// `npm run match:preview -- [--email <account email> | --resume <id>] [--full-at 8|all] [--exponents 1,0.6,0.5]`:
// how match % would spread for one resume over the open offers, for several display
// curves (MATCH_CONFIG in packages/shared/src/match.ts: skillsForFull, displayExponent).
// Without --email or --resume: the most recently updated resume that has skills. Reads
// the database only; prints counts and percentages, no offer or resume content.
import "dotenv/config";
import { computeMatch, displayScore, MATCH_CONFIG } from "@job/shared/src/match";
import { prisma } from "../lib/prisma";

const option = (name: string) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
};

async function chooseResume() {
  const email = option("--email");
  const id = option("--resume");
  const select = { id: true, name: true, skills: { select: { skillId: true } }, occupations: { select: { occupationId: true } } };
  if (email) {
    const user = await prisma.user.findFirst({ where: { email: email.toLowerCase() }, select: { selectedResumeId: true } });
    if (!user?.selectedResumeId) throw new Error(`No account with a selected resume for ${email}`);
    return prisma.resume.findUniqueOrThrow({ where: { id: user.selectedResumeId }, select });
  }
  if (id) return prisma.resume.findUniqueOrThrow({ where: { id }, select });
  const resume = await prisma.resume.findFirst({ where: { deletedAt: null, skills: { some: {} } }, orderBy: { updatedAt: "desc" }, select });
  if (!resume) throw new Error("No resume with skills in this database");
  return resume;
}

const percentile = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];

async function main() {
  const resume = await chooseResume();
  const links = { skillIds: resume.skills.map((row) => row.skillId), occupationIds: resume.occupations.map((row) => row.occupationId) };
  const fullAt = option("--full-at");
  const base = { ...MATCH_CONFIG, ...(fullAt && { skillsForFull: fullAt === "all" ? null : Number(fullAt) }) };
  const exponents = (option("--exponents") ?? `1,0.7,${MATCH_CONFIG.displayExponent},0.5,0.4`).split(",").map(Number);

  // Open public offers with their skills and occupations, read in pages.
  const offers = new Map<string, { skillIds: number[]; occupationIds: number[] }>();
  let cursor: string | undefined;
  for (;;) {
    const page = await prisma.offer.findMany({
      where: { isPublic: true, closedAt: null, skills: { some: {} } },
      select: { id: true, skills: { select: { skillId: true } }, occupations: { select: { occupationId: true } } },
      orderBy: { id: "asc" },
      take: 5000,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
    });
    if (page.length === 0) break;
    for (const offer of page) offers.set(offer.id, { skillIds: offer.skills.map((row) => row.skillId), occupationIds: offer.occupations.map((row) => row.occupationId) });
    cursor = page[page.length - 1].id;
  }

  const results = [...offers.values()].map((offer) => computeMatch(offer, links, { ...base, displayExponent: 1 }));
  const groups: [string, typeof results][] = [
    ["all open offers", results],
    ["offers sharing an occupation with the resume", results.filter((result) => result.sharesOccupation)],
  ];

  console.log(`Resume "${resume.name}": ${links.skillIds.length} skills, ${links.occupationIds.length} occupations. Skills for full coverage: ${base.skillsForFull ?? "all"}. Current exponent: ${MATCH_CONFIG.displayExponent}; badge green from ${MATCH_CONFIG.strong} %, normal from ${MATCH_CONFIG.medium} %.`);
  for (const [label, group] of groups) {
    const raw = group.map((result) => (result.rawScore ?? 0) / 100).sort((a, b) => a - b);
    console.log(`\n${label}: ${raw.length}`);
    if (raw.length === 0) continue;
    console.table(
      exponents.map((exponent) => {
        const shown = raw.map((value) => displayScore(value, { ...MATCH_CONFIG, displayExponent: exponent }));
        const share = (test: (value: number) => boolean) => `${Math.round((100 * shown.filter(test).length) / shown.length)} %`;
        return {
          exponent,
          median: `${percentile(shown, 50)} %`,
          "top 25 % from": `${percentile(shown, 75)} %`,
          "top 10 % from": `${percentile(shown, 90)} %`,
          [`green (≥ ${MATCH_CONFIG.strong})`]: share((value) => value >= MATCH_CONFIG.strong),
          [`≥ ${MATCH_CONFIG.medium}`]: share((value) => value >= MATCH_CONFIG.medium),
          "100 %": shown.filter((value) => value === 100).length,
        };
      }),
    );
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
