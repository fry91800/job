import type { Prisma } from "@prisma/client";
import {
  computeMatch,
  withItemIds,
  type GeneratedResumeDetail,
  type GeneratedResumeListItem,
  type GeneratedResumeListResponse,
  type LanguageMismatchDetails,
  type ResumeContent,
  type ResumeContentInput,
} from "@job/shared";
import { HttpError } from "../lib/http-error";
import { newItemId } from "../lib/ids";
import { prisma } from "../lib/prisma";
import { visibleOfferWhere } from "../offers/offer-access";
import { photoDataUrl } from "../photos/photos";
import { saveOffer } from "../saved-offers/saved-offers";
import { availableTemplate } from "../settings/settings";
import { renderPdf } from "../templates/pdf";
import { renderResumeHtml } from "../templates/render";

// Generated resumes (FEATURE M1, M3). Only the "modifier off" path exists for now: the
// source resume is copied as-is and rendered with a template. AI generation (modifier on)
// and change review (M4) come with the AI provider.

type SessionUser = { id: string; isGuest: boolean };

export const generatedResumeNotFound = () => new HttpError(404, "generated_resume_not_found", "Generated resume not found");

const listInclude = {
  offer: { select: { id: true, title: true, companyName: true } },
  resume: { select: { id: true, name: true } },
  template: { select: { id: true, name: true } },
} satisfies Prisma.GeneratedResumeInclude;

type Row = Prisma.GeneratedResumeGetPayload<{ include: typeof listInclude }>;

function toListItem(row: Row): GeneratedResumeListItem {
  const changes = row.changes as { status: string }[];
  return {
    id: row.id,
    offer: row.offer,
    resume: row.resume,
    language: row.language,
    template: row.template,
    modified: row.modifierStrength !== null,
    modifierStrength: row.modifierStrength,
    matchScore: row.matchScore,
    pendingChanges: changes.filter((change) => change.status === "pending").length,
    createdAt: row.createdAt.toISOString(),
  };
}

async function findOwn(userId: string, id: string): Promise<Row> {
  const row = await prisma.generatedResume.findFirst({ where: { id, userId, deletedAt: null }, include: listInclude });
  if (!row) throw generatedResumeNotFound();
  return row;
}

type GenerateInput = {
  offerId: string;
  resumeId?: string;
  templateId?: number;
  modifierEnabled?: boolean;
  ignoreLanguageMismatch?: boolean;
};

export async function generateResume(user: SessionUser, input: GenerateInput): Promise<GeneratedResumeDetail> {
  const settings = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    select: { selectedResumeId: true, templateId: true, modifierEnabled: true, selectedPhotoId: true },
  });

  if (input.modifierEnabled ?? settings.modifierEnabled) {
    throw new HttpError(501, "ai_not_available", "AI generation is not available yet: generate with the modifier off");
  }

  const resumeId = input.resumeId ?? settings.selectedResumeId;
  if (!resumeId) throw new HttpError(400, "no_resume", "Add or select a resume first");
  const resume = await prisma.resume.findFirst({
    where: { id: resumeId, userId: user.id, deletedAt: null },
    include: { skills: { select: { skillId: true } }, occupations: { select: { occupationId: true } } },
  });
  if (!resume) throw new HttpError(404, "resume_not_found", "Resume not found");

  const offer = await prisma.offer.findFirst({
    where: { id: input.offerId, ...visibleOfferWhere(user.id) },
    include: { skills: { select: { skillId: true } }, occupations: { select: { occupationId: true } } },
  });
  if (!offer) throw new HttpError(404, "offer_not_found", "Offer not found");

  // Language check (M1): the output is always in the resume's language.
  if (offer.language && offer.language !== resume.language && !input.ignoreLanguageMismatch) {
    const alternative = await prisma.resume.findFirst({
      where: { userId: user.id, deletedAt: null, language: offer.language },
      orderBy: { updatedAt: "desc" },
      select: { id: true },
    });
    const details: LanguageMismatchDetails = {
      offerLanguage: offer.language,
      resumeLanguage: resume.language,
      alternativeResumeId: alternative?.id ?? null,
    };
    throw new HttpError(409, "language_mismatch", "The offer is in another language than the resume", details);
  }

  const template = await availableTemplate(input.templateId ?? settings.templateId);
  if (input.templateId !== undefined && template.id !== input.templateId) {
    throw new HttpError(400, "unknown_template", "This template does not exist");
  }

  const match = computeMatch(
    { skillIds: offer.skills.map((link) => link.skillId), occupationIds: offer.occupations.map((link) => link.occupationId) },
    { skillIds: resume.skills.map((link) => link.skillId), occupationIds: resume.occupations.map((link) => link.occupationId) },
  );

  const row = await prisma.generatedResume.create({
    data: {
      userId: user.id,
      offerId: offer.id,
      resumeId: resume.id,
      language: resume.language,
      originalContent: resume.content as Prisma.InputJsonValue,
      generatedContent: resume.content as Prisma.InputJsonValue,
      changes: [],
      modifierStrength: null, // modifier off; modifier_config stays NULL with it
      templateId: template.id,
      photoId: template.supportsPhoto ? settings.selectedPhotoId : null,
      matchScore: match.score,
    },
  });

  // The offer is saved automatically (M1); a full saved list doesn't block generation.
  try {
    await saveOffer(user, offer.id);
  } catch (error) {
    if (!(error instanceof HttpError && error.code === "limit_reached")) throw error;
  }

  return getGeneratedResume(user.id, row.id);
}

export async function listGeneratedResumes(userId: string, offerId?: string): Promise<GeneratedResumeListResponse> {
  const rows = await prisma.generatedResume.findMany({
    where: { userId, deletedAt: null, ...(offerId && { offerId }) },
    include: listInclude,
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
  });
  return { results: rows.map(toListItem) };
}

export async function getGeneratedResume(userId: string, id: string): Promise<GeneratedResumeDetail> {
  const row = await findOwn(userId, id);
  return {
    ...toListItem(row),
    originalContent: row.originalContent as ResumeContent,
    generatedContent: row.generatedContent as ResumeContent,
    changes: row.changes as unknown[],
    photoId: row.photoId,
    updatedAt: row.updatedAt.toISOString(),
  };
}

// M3: change the template (re-render only) or edit the generated content by hand.
// When AI change sets exist, editing a field with a pending change will mark it `edited` (M4).
export async function updateGeneratedResume(
  userId: string,
  id: string,
  input: { templateId?: number; photoId?: string | null; generatedContent?: ResumeContentInput },
): Promise<GeneratedResumeDetail> {
  await findOwn(userId, id);
  const data: Prisma.GeneratedResumeUpdateInput = {};
  if (input.templateId !== undefined) {
    const template = await prisma.template.findFirst({ where: { id: input.templateId, deletedAt: null } });
    if (!template) throw new HttpError(400, "unknown_template", "This template does not exist");
    data.template = { connect: { id: template.id } };
  }
  if (input.photoId !== undefined) {
    if (input.photoId !== null) {
      const photo = await prisma.userPhoto.findFirst({ where: { id: input.photoId, userId, deletedAt: null } });
      if (!photo) throw new HttpError(404, "photo_not_found", "Photo not found");
    }
    data.photo = input.photoId === null ? { disconnect: true } : { connect: { id: input.photoId } };
  }
  if (input.generatedContent !== undefined) data.generatedContent = withItemIds(input.generatedContent, newItemId);
  await prisma.generatedResume.update({ where: { id }, data });
  return getGeneratedResume(userId, id);
}

// Soft delete: the row still counts towards AI quotas (M3).
export async function deleteGeneratedResume(userId: string, id: string): Promise<void> {
  await findOwn(userId, id);
  await prisma.generatedResume.update({ where: { id }, data: { deletedAt: new Date() } });
}

export async function renderGeneratedResumeHtml(userId: string, id: string): Promise<string> {
  const row = await prisma.generatedResume.findFirst({ where: { id, userId, deletedAt: null }, include: { template: true } });
  if (!row) throw generatedResumeNotFound();
  // The retired template still renders existing resumes as long as its code exists (S2).
  return renderResumeHtml(row.template.rendererKey, {
    content: row.generatedContent as ResumeContent,
    language: row.language,
    photoDataUrl: row.template.supportsPhoto ? await photoDataUrl(row.photoId) : null,
  });
}

// File name: {FullName}_{Company}_{yyyy-mm-dd}.pdf (M3).
export async function renderGeneratedResumePdf(userId: string, id: string) {
  const html = await renderGeneratedResumeHtml(userId, id);
  const row = await findOwn(userId, id);
  const content = row.generatedContent as ResumeContent;
  const part = (value: string | null) => (value ?? "").normalize("NFC").replace(/[^\p{L}\p{N}-]+/gu, "-").replace(/^-+|-+$/g, "");
  const fileName = [part(content.basics.fullName), part(row.offer.companyName), new Date().toISOString().slice(0, 10)]
    .filter(Boolean)
    .join("_");
  return { pdf: await renderPdf(html), fileName: `${fileName}.pdf` };
}
