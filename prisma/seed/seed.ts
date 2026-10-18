// Development seed: empties every table, then inserts a deterministic data set for
// writing and testing the API (search, offer detail, saved offers, match %).
// Run with `npm run db:seed`. Never run it against a database you care about.
import "dotenv/config";
import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../apps/api/src/auth/password";
import { occupations, skills, type CatalogueEntry } from "./catalogue";
import { normalizeCatalogueName, resumeContentSchema, withItemIds } from "@job/shared";
import { config } from "../../apps/api/src/config";
import { syncResumeLinks } from "../../apps/api/src/resumes/catalogue-links";
import { createRandom, stableUuid } from "./helpers";
import { locations } from "./locations";
import { edgeCaseOffers, generateOffers } from "./offers";
import { resumes, savedOffers, users } from "./users";

const GENERATED_OFFER_COUNT = 180;
const RANDOM_SEED = 20261012;

if (process.env.NODE_ENV === "production") {
  throw new Error("The development seed must not run in production");
}
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not defined");
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function truncateAll() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  const list = tables.map(({ tablename }) => `"public"."${tablename}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

// Inserts catalogue entries with their fr/en names; returns key -> id.
async function seedCatalogue(
  entries: CatalogueEntry[],
  insertEntries: (rows: { source: string; externalId: string }[]) => Promise<unknown>,
  findEntries: () => Promise<{ id: number; externalId: string | null }[]>,
  insertNames: (rows: { ownerId: number; language: string; name: string; normalizedName: string; isCanonical: boolean }[]) => Promise<unknown>,
): Promise<Map<string, number>> {
  await insertEntries(entries.map((entry) => ({ source: "manual", externalId: entry.key })));
  const ids = new Map((await findEntries()).map((row) => [row.externalId!, row.id]));

  const names = entries.flatMap((entry) =>
    (["fr", "en"] as const).flatMap((language) => {
      const seen = new Set<string>();
      return entry[language].flatMap((name, index) => {
        const normalizedName = normalizeCatalogueName(name);
        if (seen.has(normalizedName)) return [];
        seen.add(normalizedName);
        return [{ ownerId: ids.get(entry.key)!, language, name, normalizedName, isCanonical: index === 0 }];
      });
    }),
  );
  await insertNames(names);
  return ids;
}

async function main() {
  await truncateAll();
  // Uploaded files belong to the rows just deleted.
  await rm(resolve(config.storage.localDir), { recursive: true, force: true });

  // Templates: id 1 is the default referenced by users.template_id.
  await prisma.template.createMany({
    data: [
      { name: "Classic", rendererKey: "classic", previewStorageKey: "templates/classic.jpg", supportsPhoto: true, sortOrder: 1 },
      { name: "Modern", rendererKey: "modern", previewStorageKey: "templates/modern.jpg", supportsPhoto: false, sortOrder: 2 },
      // Same rows as the migration 20261018170000_more_templates.
      { name: "Contemporary", rendererKey: "contemporary", previewStorageKey: "templates/contemporary.jpg", supportsPhoto: true, sortOrder: 3 },
      { name: "Minimal", rendererKey: "minimal", previewStorageKey: "templates/minimal.jpg", supportsPhoto: false, sortOrder: 4 },
      { name: "Elegant", rendererKey: "elegant", previewStorageKey: "templates/elegant.jpg", supportsPhoto: true, sortOrder: 5 },
      { name: "Executive", rendererKey: "executive", previewStorageKey: "templates/executive.jpg", supportsPhoto: true, sortOrder: 6 },
      { name: "Creative", rendererKey: "creative", previewStorageKey: "templates/creative.jpg", supportsPhoto: true, sortOrder: 7 },
      { name: "Compact", rendererKey: "compact", previewStorageKey: "templates/compact.jpg", supportsPhoto: false, sortOrder: 8 },
    ],
  });

  // Locations.
  await prisma.location.createMany({
    data: locations.map(({ key, ...location }) => ({ ...location, provider: "seed", externalId: key })),
  });
  const locationIds = new Map(
    (await prisma.location.findMany({ select: { id: true, externalId: true } })).map((row) => [row.externalId!, row.id]),
  );
  const locationId = (key: string | null) => {
    if (key === null) return null;
    const id = locationIds.get(key);
    if (id === undefined) throw new Error(`Unknown location key: ${key}`);
    return id;
  };

  // Skills and occupations catalogue.
  const skillIds = await seedCatalogue(
    skills,
    (data) => prisma.skill.createMany({ data }),
    () => prisma.skill.findMany({ select: { id: true, externalId: true } }),
    (rows) => prisma.skillName.createMany({ data: rows.map(({ ownerId, ...row }) => ({ ...row, skillId: ownerId })) }),
  );
  const occupationIds = await seedCatalogue(
    occupations,
    (data) => prisma.occupation.createMany({ data }),
    () => prisma.occupation.findMany({ select: { id: true, externalId: true } }),
    (rows) => prisma.occupationName.createMany({ data: rows.map(({ ownerId, ...row }) => ({ ...row, occupationId: ownerId })) }),
  );
  const skillId = (key: string) => {
    const id = skillIds.get(key);
    if (id === undefined) throw new Error(`Unknown skill key: ${key}`);
    return id;
  };
  const occupationId = (key: string) => {
    const id = occupationIds.get(key);
    if (id === undefined) throw new Error(`Unknown occupation key: ${key}`);
    return id;
  };

  // Users and their sessions.
  const userId = (key: string) => stableUuid(`user:${key}`);
  const passwordHashes = await Promise.all(users.map((user) => (user.password ? hashPassword(user.password) : null)));
  await prisma.user.createMany({
    data: users.map((user, index) => ({
      id: userId(user.key),
      email: user.email,
      passwordHash: passwordHashes[index],
      emailVerifiedAt: user.email ? new Date() : null,
      uiLanguage: user.uiLanguage,
      searchLocationId: locationId(user.searchLocationKey),
      modifierEnabled: user.modifierEnabled,
      modifierStrength: user.modifierStrength,
      templateId: 1,
    })),
  });
  await prisma.session.createMany({
    data: users.map((user) => ({
      userId: userId(user.key),
      tokenHash: sha256(user.sessionToken),
      userAgent: "seed",
      expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
    })),
  });

  // Resumes, their catalogue links (same extraction as the API, M2), and the selected resume.
  const resumeId = (key: string) => stableUuid(`resume:${key}`);
  for (const resume of resumes) {
    // Fails the seed if the sample content drifts from ResumeContent v1.
    const content = withItemIds(resumeContentSchema.parse(resume.content), () => {
      throw new Error(`Seed resume ${resume.key} has an item without id`);
    });
    await prisma.resume.create({
      data: {
        id: resumeId(resume.key),
        userId: userId(resume.userKey),
        name: resume.name,
        language: resume.language,
        content,
        translatedFromResumeId: resume.translatedFromKey ? resumeId(resume.translatedFromKey) : null,
      },
    });
    await syncResumeLinks(prisma, resumeId(resume.key), content, resume.language);
    if (resume.selected) {
      await prisma.user.update({ where: { id: userId(resume.userKey) }, data: { selectedResumeId: resumeId(resume.key) } });
    }
  }

  // Offers and their catalogue links.
  const offers = [...edgeCaseOffers(), ...generateOffers(createRandom(RANDOM_SEED), GENERATED_OFFER_COUNT)];
  const offerId = (key: string) => stableUuid(`offer:${key}`);
  await prisma.offer.createMany({
    data: offers.map((offer) => ({
      id: offerId(offer.key),
      title: offer.title,
      companyName: offer.companyName,
      description: offer.description,
      language: offer.language,
      url: offer.url,
      locationId: locationId(offer.locationKey),
      remoteType: offer.remoteType,
      contractType: offer.contractType,
      salaryMin: offer.salaryMin,
      salaryMax: offer.salaryMax,
      salaryCurrency: offer.salaryCurrency,
      salaryPeriod: offer.salaryPeriod,
      isPublic: offer.isPublic,
      source: offer.source,
      externalId: offer.externalId,
      rawData: offer.source === "seed" ? { seed: true } : undefined,
      createdByUserId: offer.createdByUserKey ? userId(offer.createdByUserKey) : null,
      publishedAt: offer.publishedAt,
      collectedAt: offer.publishedAt ?? new Date(),
      lastVerifiedAt: offer.closedAt ?? new Date(),
      closedAt: offer.closedAt,
    })),
  });
  await prisma.offerSkill.createMany({
    data: offers.flatMap((offer) => offer.skillKeys.map((key) => ({ offerId: offerId(offer.key), skillId: skillId(key) }))),
  });
  await prisma.offerOccupation.createMany({
    data: offers.flatMap((offer) => offer.occupationKeys.map((key) => ({ offerId: offerId(offer.key), occupationId: occupationId(key) }))),
  });

  // Saved offers.
  await prisma.savedOffer.createMany({
    data: savedOffers.map((saved) => ({
      id: stableUuid(`saved:${saved.userKey}:${saved.offerKey}`),
      userId: userId(saved.userKey),
      offerId: offerId(saved.offerKey),
      status: saved.status,
      notes: saved.notes,
      appliedAt: saved.appliedAt,
      statusChangedAt: saved.statusChangedAt,
    })),
  });

  const publicOpen = offers.filter((offer) => offer.isPublic && !offer.closedAt).length;
  console.log(`Seeded ${locations.length} locations, ${skills.length} skills, ${occupations.length} occupations,`);
  console.log(`${offers.length} offers (${publicOpen} public and open), ${users.length} users, ${resumes.length} resumes, ${savedOffers.length} saved offers.`);
  console.log("Dev session tokens (send the raw value as the session cookie):");
  for (const user of users) {
    console.log(`  ${user.key.padEnd(6)} ${user.sessionToken}${user.email ? `  (${user.email} / ${user.password})` : "  (guest)"}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
