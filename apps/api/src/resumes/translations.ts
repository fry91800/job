import type { ResumeContent, ResumeDetail, ResumeLanguage, TranslateFieldResponse } from "@job/shared";
import { consumeAiRateLimit } from "../ai/rate-limit";
import { config } from "../config";
import { HttpError } from "../lib/http-error";
import { prisma } from "../lib/prisma";
import { createResume, resumeNotFound } from "./resumes";
import { translateField, translateResume } from "./resume-translator";

// Resume translation (FEATURE T1): a new resume linked to its source.

type SessionUser = { id: string; isGuest: boolean };

async function findOwn(userId: string, resumeId: string) {
  const resume = await prisma.resume.findFirst({ where: { id: resumeId, userId, deletedAt: null } });
  if (!resume) throw resumeNotFound();
  return resume;
}

// Counted from translated resumes, deleted ones included (DATABASE.md "resumes").
async function checkTranslationQuota(user: SessionUser): Promise<void> {
  const { guestTotal, registeredPerDay } = config.limits.translations;
  const since = user.isGuest ? undefined : new Date(Date.now() - 24 * 3600 * 1000);
  const count = await prisma.resume.count({
    where: { userId: user.id, translatedFromResumeId: { not: null }, ...(since && { createdAt: { gte: since } }) },
  });
  if (count >= (user.isGuest ? guestTotal : registeredPerDay)) {
    throw new HttpError(429, "limit_reached", user.isGuest ? "Create an account to translate more resumes" : "Daily translation limit reached");
  }
}

export async function createTranslation(
  user: SessionUser,
  ip: string,
  sourceId: string,
  input: { language: ResumeLanguage; force?: boolean },
): Promise<ResumeDetail> {
  const source = await findOwn(user.id, sourceId);
  if (source.language === input.language) throw new HttpError(400, "same_language", "The resume is already in this language");

  if (!input.force) {
    const existing = await prisma.resume.findFirst({
      where: { userId: user.id, translatedFromResumeId: source.id, language: input.language, deletedAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (existing) {
      throw new HttpError(409, "translation_exists", "This resume is already translated into this language", { existingResumeId: existing.id });
    }
  }

  // Checked before the AI call, so a full resume list doesn't cost a translation.
  const resumeLimit = user.isGuest ? config.limits.resumes.guest : config.limits.resumes.registered;
  if ((await prisma.resume.count({ where: { userId: user.id, deletedAt: null } })) >= resumeLimit) {
    throw new HttpError(429, "limit_reached", `You can keep at most ${resumeLimit} resumes`);
  }
  await checkTranslationQuota(user);
  consumeAiRateLimit(ip);

  const content = await translateResume(source.content as ResumeContent, source.language as ResumeLanguage, input.language);
  return createResume(user, {
    name: `${source.name} (${input.language.toUpperCase()})`.slice(0, 100),
    language: input.language,
    content,
    translatedFromResumeId: source.id,
  });
}

// "Re-translate" one field of a translated resume, from its source (T1 review screen).
// Not saved: the user edits the field and saves the resume. Covered by the per-IP limit,
// not by the translation quota.
export async function retranslateField(userId: string, ip: string, resumeId: string, path: string): Promise<TranslateFieldResponse> {
  const resume = await findOwn(userId, resumeId);
  if (!resume.translatedFromResumeId) throw new HttpError(400, "not_a_translation", "This resume is not a translation");
  const source = await prisma.resume.findFirst({ where: { id: resume.translatedFromResumeId, userId, deletedAt: null } });
  if (!source) throw new HttpError(409, "source_deleted", "The original resume was deleted");

  consumeAiRateLimit(ip);
  const text = await translateField(source.content as ResumeContent, path, source.language as ResumeLanguage, resume.language as ResumeLanguage);
  return { path, text };
}
