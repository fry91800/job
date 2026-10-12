import type { Prisma } from "@prisma/client";
import { config } from "../config";
import { prisma } from "../lib/prisma";
import { deleteFile } from "../lib/storage";

// Daily cleanup (FEATURE "Background jobs"): expired sessions and tokens, inactive guests
// (G3), deleted accounts (A5), soft-deleted resumes and photos (R5, R6), with their files.
// Rows are deleted first, files after: a leftover file is harmless, a row pointing to a
// missing file is not. Every step is idempotent, so running it twice is safe.

const BATCH = 100;
const DAY_MS = 24 * 3600 * 1000;

export type CleanupResult = {
  sessions: number;
  userTokens: number;
  guests: number;
  deletedAccounts: number;
  photos: number;
  resumes: number;
  files: number;
};

async function deleteFiles(keys: (string | null)[]): Promise<number> {
  let deleted = 0;
  for (const key of keys) {
    if (!key) continue;
    try {
      await deleteFile(key);
      deleted++;
    } catch (error) {
      console.error(`cleanup: could not delete file ${key}`, error);
    }
  }
  return deleted;
}

// Hard-deletes users with everything they own (rows cascade) and their files.
async function purgeUsers(where: Prisma.UserWhereInput, result: CleanupResult): Promise<number> {
  let purged = 0;
  for (;;) {
    const users = await prisma.user.findMany({
      where,
      take: BATCH,
      select: { id: true, photos: { select: { storageKey: true } }, resumes: { select: { sourceFileKey: true } } },
    });
    if (users.length === 0) return purged;

    await prisma.user.deleteMany({ where: { id: { in: users.map((user) => user.id) } } });
    purged += users.length;
    result.files += await deleteFiles(
      users.flatMap((user) => [...user.photos.map((photo) => photo.storageKey), ...user.resumes.map((resume) => resume.sourceFileKey)]),
    );
  }
}

export async function runCleanup(now = new Date()): Promise<CleanupResult> {
  const daysAgo = (days: number) => new Date(now.getTime() - days * DAY_MS);
  const result: CleanupResult = { sessions: 0, userTokens: 0, guests: 0, deletedAccounts: 0, photos: 0, resumes: 0, files: 0 };

  result.sessions = (await prisma.session.deleteMany({ where: { expiresAt: { lt: now } } })).count;
  result.userTokens = (await prisma.userToken.deleteMany({ where: { OR: [{ expiresAt: { lt: now } }, { usedAt: { not: null } }] } })).count;

  // Guests inactive for 30 days (G3). Deleted accounts also have no email: excluded here.
  result.guests = await purgeUsers(
    { email: null, deletedAt: null, lastActiveAt: { lt: daysAgo(config.cleanup.guestInactiveDays) } },
    result,
  );
  // Accounts deleted more than 30 days ago (A5).
  result.deletedAccounts = await purgeUsers({ deletedAt: { lt: daysAgo(config.cleanup.deletedAccountDays) } }, result);

  // Soft-deleted photos: generated resumes that used them render without a photo (R6).
  const itemCutoff = daysAgo(config.cleanup.deletedItemDays);
  for (;;) {
    const photos = await prisma.userPhoto.findMany({ where: { deletedAt: { lt: itemCutoff } }, take: BATCH, select: { id: true, storageKey: true } });
    if (photos.length === 0) break;
    await prisma.userPhoto.deleteMany({ where: { id: { in: photos.map((photo) => photo.id) } } });
    result.photos += photos.length;
    result.files += await deleteFiles(photos.map((photo) => photo.storageKey));
  }

  // Soft-deleted resumes: generated resumes keep their snapshot (resume_id becomes NULL).
  for (;;) {
    const resumes = await prisma.resume.findMany({ where: { deletedAt: { lt: itemCutoff } }, take: BATCH, select: { id: true, sourceFileKey: true } });
    if (resumes.length === 0) break;
    await prisma.resume.deleteMany({ where: { id: { in: resumes.map((resume) => resume.id) } } });
    result.resumes += resumes.length;
    result.files += await deleteFiles(resumes.map((resume) => resume.sourceFileKey));
  }

  return result;
}

// Runs the cleanup every `intervalHours` inside the API process, first a minute after
// start. With several API processes, each runs it; that is safe (idempotent) but wasteful:
// move it to a single cron job at that point.
export function scheduleCleanup(): (() => void) | undefined {
  if (config.cleanup.intervalHours <= 0) return undefined;

  const run = async () => {
    try {
      const result = await runCleanup();
      console.log("cleanup:", JSON.stringify(result));
    } catch (error) {
      console.error("cleanup failed", error);
    }
  };
  const first = setTimeout(run, 60 * 1000);
  const every = setInterval(run, config.cleanup.intervalHours * 3600 * 1000);
  first.unref();
  every.unref();
  return () => {
    clearTimeout(first);
    clearInterval(every);
  };
}
