import type { Prisma, Resume } from "@prisma/client";
import { withItemIds, type ResumeContent, type ResumeContentInput, type ResumeDetail, type ResumeListItem, type ResumeListResponse } from "@job/shared";
import { consumeAiRateLimit } from "../ai/rate-limit";
import { config } from "../config";
import { HttpError } from "../lib/http-error";
import { newItemId } from "../lib/ids";
import { prisma } from "../lib/prisma";
import { deleteFile, getFile, newStorageKey, putFile } from "../lib/storage";
import { syncResumeLinks } from "./catalogue-links";
import { parseResumeFile } from "./resume-parser";

// Resumes (FEATURE R1–R5).

type SessionUser = { id: string; isGuest: boolean };

export const resumeNotFound = () => new HttpError(404, "resume_not_found", "Resume not found");

const listInclude = {
  translatedFrom: { select: { id: true, name: true, deletedAt: true, updatedAt: true } },
  selectedBy: { select: { id: true } },
} satisfies Prisma.ResumeInclude;

type ResumeWithList = Prisma.ResumeGetPayload<{ include: typeof listInclude }>;

function toListItem(resume: ResumeWithList): ResumeListItem {
  const source = resume.translatedFrom;
  return {
    id: resume.id,
    name: resume.name,
    language: resume.language,
    isSelected: resume.selectedBy !== null,
    hasSourceFile: resume.sourceFileKey !== null,
    translatedFrom:
      source && !source.deletedAt
        ? { id: source.id, name: source.name, changedSinceTranslation: source.updatedAt > resume.createdAt }
        : null,
    updatedAt: resume.updatedAt.toISOString(),
  };
}

// The user's non-deleted resume, or 404 (other users' resumes look like missing ones).
async function findOwnResume(userId: string, resumeId: string): Promise<Resume> {
  const resume = await prisma.resume.findFirst({ where: { id: resumeId, userId, deletedAt: null } });
  if (!resume) throw resumeNotFound();
  return resume;
}

export async function listResumes(userId: string): Promise<ResumeListResponse> {
  const resumes = await prisma.resume.findMany({
    where: { userId, deletedAt: null },
    include: listInclude,
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
  });
  return { results: resumes.map(toListItem) };
}

export async function getResume(userId: string, resumeId: string): Promise<ResumeDetail> {
  const resume = await prisma.resume.findFirst({
    where: { id: resumeId, userId, deletedAt: null },
    include: { ...listInclude, skills: { select: { skillId: true } }, occupations: { select: { occupationId: true } } },
  });
  if (!resume) throw resumeNotFound();
  return {
    ...toListItem(resume),
    content: resume.content as ResumeContent,
    skillIds: resume.skills.map((link) => link.skillId),
    occupationIds: resume.occupations.map((link) => link.occupationId),
    createdAt: resume.createdAt.toISOString(),
  };
}

type NewResume = {
  name?: string;
  language: string;
  content: ResumeContentInput;
  sourceFileKey?: string;
  translatedFromResumeId?: string;
};

// Creates a resume (from scratch, upload or translation). Becomes the selected resume if
// the user has none (R2), except translations, which are never selected automatically (T1).
export async function createResume(user: SessionUser, input: NewResume): Promise<ResumeDetail> {
  const limit = user.isGuest ? config.limits.resumes.guest : config.limits.resumes.registered;
  const count = await prisma.resume.count({ where: { userId: user.id, deletedAt: null } });
  if (count >= limit) throw new HttpError(429, "limit_reached", `You can keep at most ${limit} resumes`);

  const content = withItemIds(input.content, newItemId);
  // The default name is in the user's interface language (R2).
  const { uiLanguage } = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { uiLanguage: true } });
  const defaultName = `${uiLanguage === "fr" ? "CV" : "Resume"} ${count + 1}`;
  const resume = await prisma.$transaction(async (tx) => {
    const created = await tx.resume.create({
      data: {
        userId: user.id,
        name: input.name ?? defaultName,
        language: input.language,
        content,
        sourceFileKey: input.sourceFileKey ?? null,
        translatedFromResumeId: input.translatedFromResumeId ?? null,
      },
    });
    await syncResumeLinks(tx, created.id, content, input.language);
    if (!input.translatedFromResumeId) {
      await tx.user.updateMany({ where: { id: user.id, selectedResumeId: null }, data: { selectedResumeId: created.id } });
    }
    return created;
  });
  return getResume(user.id, resume.id);
}

// Full replacement of name, language and content (R3). Links are re-extracted (M2).
export async function updateResume(userId: string, resumeId: string, input: { name: string; language: string; content: ResumeContentInput }) {
  await findOwnResume(userId, resumeId);
  const content = withItemIds(input.content, newItemId);
  await prisma.$transaction(async (tx) => {
    await tx.resume.update({ where: { id: resumeId }, data: { name: input.name, language: input.language, content } });
    await syncResumeLinks(tx, resumeId, content, input.language);
  });
  return getResume(userId, resumeId);
}

export async function selectResume(userId: string, resumeId: string): Promise<void> {
  await findOwnResume(userId, resumeId);
  await prisma.user.update({ where: { id: userId }, data: { selectedResumeId: resumeId } });
}

// Soft delete (R5). Clears the selection; generated resumes keep their snapshot.
export async function deleteResume(userId: string, resumeId: string): Promise<void> {
  await findOwnResume(userId, resumeId);
  await prisma.$transaction([
    prisma.user.updateMany({ where: { id: userId, selectedResumeId: resumeId }, data: { selectedResumeId: null } }),
    prisma.resume.update({ where: { id: resumeId }, data: { deletedAt: new Date() } }),
  ]);
}

const fileTypes = {
  pdf: { extension: "pdf", contentType: "application/pdf" },
  docx: { extension: "docx", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
} as const;

// Recognized from the content, not from the file name or the declared type.
function detectFileType(file: Buffer): keyof typeof fileTypes | null {
  if (file.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  // DOCX = zip archive containing word/document.xml (zip file names are stored as plain text).
  if (file.subarray(0, 4).toString("latin1") === "PK\x03\x04" && file.includes("word/document.xml")) return "docx";
  return null;
}

async function checkUploadQuota(user: SessionUser): Promise<void> {
  const uploads = { userId: user.id, sourceFileKey: { not: null } };
  if (user.isGuest) {
    const total = await prisma.resume.count({ where: uploads });
    if (total >= config.limits.resumeUploads.guestTotal) {
      throw new HttpError(429, "limit_reached", "Upload limit reached: create an account to upload more resumes");
    }
  } else {
    const since = new Date(Date.now() - 24 * 3600 * 1000);
    const today = await prisma.resume.count({ where: { ...uploads, createdAt: { gte: since } } });
    if (today >= config.limits.resumeUploads.registeredPerDay) {
      throw new HttpError(429, "limit_reached", "Daily upload limit reached");
    }
  }
}

// Upload a PDF/DOCX (R2): the file is stored, parsed into ResumeContent and the resume
// is saved immediately.
export async function uploadResume(user: SessionUser, ip: string, file: Buffer, name: string | undefined): Promise<ResumeDetail> {
  if (file.length === 0) throw new HttpError(400, "empty_file", "The file is empty");
  const type = detectFileType(file);
  if (!type) throw new HttpError(415, "unsupported_file_type", "Only PDF and DOCX files are accepted");
  await checkUploadQuota(user);
  consumeAiRateLimit(ip);

  const key = newStorageKey("resume-sources", user.id, fileTypes[type].extension);
  await putFile(key, file);
  try {
    const parsed = await parseResumeFile(file, type);
    return await createResume(user, { name, language: parsed.language, content: parsed.content, sourceFileKey: key });
  } catch (error) {
    await deleteFile(key);
    throw error;
  }
}

// The original uploaded file, available while the resume exists (R5).
export async function getSourceFile(userId: string, resumeId: string) {
  const resume = await findOwnResume(userId, resumeId);
  if (!resume.sourceFileKey) throw new HttpError(404, "no_source_file", "This resume was not uploaded from a file");
  const type = resume.sourceFileKey.endsWith(".pdf") ? fileTypes.pdf : fileTypes.docx;
  return { data: await getFile(resume.sourceFileKey), contentType: type.contentType, fileName: `${resume.name}.${type.extension}` };
}
