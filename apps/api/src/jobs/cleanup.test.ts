import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { after, before, describe, test } from "node:test";
import { emptyResumeContent } from "@job/shared";
import { hashToken } from "../auth/session";
import { config } from "../config";
import { putFile } from "../lib/storage";
import { prisma, seedOfferId, seedUserId, startTestServer } from "../test/helpers";
import { runCleanup } from "./cleanup";

// Rows are backdated instead of moving the clock, so the seeded data is never purged.

let server: Awaited<ReturnType<typeof startTestServer>>;

before(async () => {
  server = await startTestServer();
});
after(() => server.close());

const DAY_MS = 24 * 3600 * 1000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS);
const fileExists = (key: string) =>
  access(resolve(config.storage.localDir, key)).then(
    () => true,
    () => false,
  );

let counter = 0;
async function userWithFiles(data: { email?: string; passwordHash?: string; lastActiveAt?: Date; deletedAt?: Date }) {
  const user = await prisma.user.create({ data });
  const photoKey = `photos/${user.id}/test-${counter++}.webp`;
  const resumeKey = `resume-sources/${user.id}/test-${counter++}.pdf`;
  await putFile(photoKey, Buffer.from("image"));
  await putFile(resumeKey, Buffer.from("%PDF-"));
  await prisma.userPhoto.create({ data: { userId: user.id, name: "p", storageKey: photoKey, mimeType: "image/webp", sizeBytes: 5 } });
  await prisma.resume.create({ data: { userId: user.id, name: "r", language: "fr", content: emptyResumeContent("A"), sourceFileKey: resumeKey } });
  return { user, photoKey, resumeKey };
}

const exists = async (id: string) => (await prisma.user.count({ where: { id } })) === 1;

describe("cleanup job", () => {
  test("deletes expired sessions and used or expired tokens only", async () => {
    const user = await prisma.user.create({ data: {} });
    const expired = await prisma.session.create({ data: { userId: user.id, tokenHash: hashToken(`expired-${user.id}`), expiresAt: daysAgo(1) } });
    const valid = await prisma.session.create({ data: { userId: user.id, tokenHash: hashToken(`valid-${user.id}`), expiresAt: daysAgo(-1) } });
    const tokens = await Promise.all(
      [
        { expiresAt: daysAgo(1) },
        { expiresAt: daysAgo(-1), usedAt: new Date() },
        { expiresAt: daysAgo(-1) },
      ].map((data, index) =>
        prisma.userToken.create({ data: { userId: user.id, type: "password_reset", tokenHash: hashToken(`t${index}-${user.id}`), ...data } }),
      ),
    );

    await runCleanup();
    assert.equal(await prisma.session.count({ where: { id: expired.id } }), 0);
    assert.equal(await prisma.session.count({ where: { id: valid.id } }), 1);
    assert.deepEqual(
      (await prisma.userToken.findMany({ where: { userId: user.id }, select: { id: true } })).map((token) => token.id),
      [tokens[2].id],
    );
    // The seeded dev sessions are still valid.
    assert.equal(await prisma.session.count({ where: { userId: seedUserId("demo") } }), 1);
  });

  test("purges guests inactive for 30 days with their files, keeps everyone else", async () => {
    const inactiveGuest = await userWithFiles({ lastActiveAt: daysAgo(31) });
    const activeGuest = await userWithFiles({ lastActiveAt: daysAgo(29) });
    const inactiveAccount = await userWithFiles({ email: `old-${counter}@example.test`, passwordHash: "x", lastActiveAt: daysAgo(400) });

    const result = await runCleanup();
    assert.ok(result.guests >= 1);
    assert.equal(await exists(inactiveGuest.user.id), false);
    assert.equal(await fileExists(inactiveGuest.photoKey), false);
    assert.equal(await fileExists(inactiveGuest.resumeKey), false);
    assert.equal(await exists(activeGuest.user.id), true);
    assert.equal(await fileExists(activeGuest.photoKey), true);
    assert.equal(await exists(inactiveAccount.user.id), true, "registered users are never purged for inactivity");
  });

  test("purges accounts deleted more than 30 days ago", async () => {
    const old = await userWithFiles({ deletedAt: daysAgo(31) });
    const recent = await userWithFiles({ deletedAt: daysAgo(5) });
    await runCleanup();
    assert.equal(await exists(old.user.id), false);
    assert.equal(await fileExists(old.resumeKey), false);
    assert.equal(await exists(recent.user.id), true);
  });

  test("purges soft-deleted photos and resumes after 30 days; generated resumes keep their snapshot", async () => {
    const { user, photoKey, resumeKey } = await userWithFiles({ email: `items-${counter}@example.test`, passwordHash: "x" });
    const photo = await prisma.userPhoto.findFirstOrThrow({ where: { userId: user.id } });
    const resume = await prisma.resume.findFirstOrThrow({ where: { userId: user.id } });
    const generated = await prisma.generatedResume.create({
      data: {
        userId: user.id, offerId: seedOfferId("edge-brunoy-fullstack"), resumeId: resume.id, photoId: photo.id, language: "fr",
        originalContent: resume.content!, generatedContent: resume.content!, templateId: 1,
      },
    });
    const recentPhoto = await prisma.userPhoto.create({
      data: { userId: user.id, name: "recent", storageKey: `photos/${user.id}/recent.webp`, mimeType: "image/webp", sizeBytes: 1, deletedAt: daysAgo(3) },
    });

    await prisma.userPhoto.update({ where: { id: photo.id }, data: { deletedAt: daysAgo(31) } });
    await prisma.resume.update({ where: { id: resume.id }, data: { deletedAt: daysAgo(31) } });
    await runCleanup();

    assert.equal(await prisma.userPhoto.count({ where: { id: photo.id } }), 0);
    assert.equal(await prisma.resume.count({ where: { id: resume.id } }), 0);
    assert.equal(await fileExists(photoKey), false);
    assert.equal(await fileExists(resumeKey), false);
    assert.equal(await prisma.userPhoto.count({ where: { id: recentPhoto.id } }), 1);

    const after = await prisma.generatedResume.findUniqueOrThrow({ where: { id: generated.id } });
    assert.equal(after.resumeId, null);
    assert.equal(after.photoId, null);
    assert.deepEqual(after.generatedContent, resume.content);
  });

  test("running it twice is harmless", async () => {
    await runCleanup();
    const second = await runCleanup();
    assert.deepEqual({ ...second, sessions: 0, userTokens: 0 }, { sessions: 0, userTokens: 0, guests: 0, deletedAccounts: 0, photos: 0, resumes: 0, files: 0 });
  });
});
