import type { Prisma } from "@prisma/client";
import {
  computeMatch,
  withItemIds,
  type GeneratedResumeDetail,
  type GeneratedResumeListItem,
  type GeneratedResumeListResponse,
  type LanguageMismatchDetails,
  type ModifierConfig,
  type ModifierStrength,
  type ResumeChange,
  type ResumeContent,
  type ResumeContentInput,
} from "@job/shared";
import { consumeAiRateLimit } from "../ai/rate-limit";
import { config } from "../config";
import { HttpError } from "../lib/http-error";
import { newItemId } from "../lib/ids";
import { prisma } from "../lib/prisma";
import { visibleOfferWhere } from "../offers/offer-access";
import { photoDataUrl } from "../photos/photos";
import { saveOffer } from "../saved-offers/saved-offers";
import { availableTemplate, modifierSections } from "../settings/settings";
import { renderPdf } from "../templates/pdf";
import { renderResumeHtml } from "../templates/render";
import { applyChanges, ChangeSetError, computeChanges, markEditedChanges, setChangeStatus } from "./change-set";
import { enabledSections, GENERATE_RESUME_PROMPT_VERSION, proposeModifications } from "./resume-modifier";

// Generated resumes (FEATURE M1, M3, M4). Modifier off: the source resume is copied and
// rendered with a template. Modifier on: the AI proposes modifications, the API turns them
// into a change set the user reviews (accept / reject each change).

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
  modifierStrength?: ModifierStrength;
  modifierConfig?: ModifierConfig;
  remember?: boolean;
  ignoreLanguageMismatch?: boolean;
};

// Only generations that call the AI count (FEATURE G4, P16), deleted ones included.
async function checkGenerationQuota(user: SessionUser): Promise<void> {
  const { guestTotal, registeredPerDay } = config.limits.aiGenerations;
  const since = user.isGuest ? undefined : new Date(Date.now() - 24 * 3600 * 1000);
  const count = await prisma.generatedResume.count({
    where: { userId: user.id, modifierStrength: { not: null }, ...(since && { createdAt: { gte: since } }) },
  });
  if (count >= (user.isGuest ? guestTotal : registeredPerDay)) {
    throw new HttpError(429, "limit_reached", user.isGuest ? "Create an account to generate more resumes" : "Daily generation limit reached");
  }
}

export async function generateResume(user: SessionUser, input: GenerateInput, ip: string): Promise<GeneratedResumeDetail> {
  const settings = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    select: { selectedResumeId: true, templateId: true, modifierEnabled: true, modifierStrength: true, modifierConfig: true, selectedPhotoId: true },
  });

  // The settings are the defaults; the request may override them once (M1).
  const modifierEnabled = input.modifierEnabled ?? settings.modifierEnabled;
  const strength = input.modifierStrength ?? (settings.modifierStrength as ModifierStrength);
  // The sections come from the strength, or from the user's choice when users choose them.
  const userChoice = input.modifierConfig ?? (settings.modifierConfig as ModifierConfig);
  const sections = modifierSections(strength, userChoice);
  if (input.remember) {
    await prisma.user.update({
      where: { id: user.id },
      data: { modifierEnabled, modifierStrength: strength, ...(config.modifier.userChoosesSections && { modifierConfig: userChoice }) },
    });
  }
  if (modifierEnabled && enabledSections(sections).length === 0) {
    throw new HttpError(
      400,
      "no_section_selected",
      config.modifier.userChoosesSections ? "Choose at least one section the AI may modify" : "No section can be modified at this strength",
    );
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

  const original = resume.content as ResumeContent;
  let generated = original;
  let changes: ResumeChange[] = [];
  let aiModel: string | null = null;

  if (modifierEnabled) {
    await checkGenerationQuota(user);
    consumeAiRateLimit(ip);

    const offerSkills = await prisma.skillName.findMany({
      where: { skillId: { in: offer.skills.map((link) => link.skillId) }, isCanonical: true, language: resume.language },
      select: { name: true },
    });
    const { proposal, model } = await proposeModifications({
      resume: original,
      language: resume.language,
      offer: { title: offer.title, companyName: offer.companyName, description: offer.description, skillNames: offerSkills.map((skill) => skill.name) },
      strength,
      sections,
    });
    const result = computeChanges(original, proposal, sections, strength, newItemId);
    if (result.violations.length > 0) {
      // Logged for prompt improvement (M4); never the content itself.
      console.warn(`generate-resume: ${result.violations.length} modification(s) dropped`, result.violations.slice(0, 10));
    }
    changes = result.changes;
    generated = applyChanges(original, changes);
    aiModel = model;
  }

  const row = await prisma.generatedResume.create({
    data: {
      userId: user.id,
      offerId: offer.id,
      resumeId: resume.id,
      language: resume.language,
      originalContent: original as Prisma.InputJsonValue,
      generatedContent: generated as Prisma.InputJsonValue,
      changes: changes as unknown as Prisma.InputJsonValue,
      // Modifier off: strength, config, model and prompt version all stay NULL.
      modifierStrength: modifierEnabled ? strength : null,
      modifierConfig: modifierEnabled ? (sections as Prisma.InputJsonValue) : undefined,
      aiModel,
      promptVersion: modifierEnabled ? GENERATE_RESUME_PROMPT_VERSION : null,
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
    changes: row.changes as ResumeChange[],
    modifierConfig: row.modifierConfig as Record<string, boolean> | null,
    aiModel: row.aiModel,
    photoId: row.photoId,
    updatedAt: row.updatedAt.toISOString(),
  };
}

// M3: change the template or photo (re-render only) or edit the generated content by hand.
// Editing a field that has a change makes that change `edited`: the manual value wins (M4).
export async function updateGeneratedResume(
  userId: string,
  id: string,
  input: { templateId?: number; photoId?: string | null; generatedContent?: ResumeContentInput },
): Promise<GeneratedResumeDetail> {
  const row = await findOwn(userId, id);
  // Set here: Prisma doesn't refresh `updatedAt` when only a relation changes (template,
  // photo), and the preview reloads when it changes.
  const data: Prisma.GeneratedResumeUpdateInput = { updatedAt: new Date() };
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
  if (input.generatedContent !== undefined) {
    const next = withItemIds(input.generatedContent, newItemId);
    data.generatedContent = next;
    data.changes = markEditedChanges(row.generatedContent as ResumeContent, next, row.changes as ResumeChange[]) as unknown as Prisma.InputJsonValue;
  }
  await prisma.generatedResume.update({ where: { id }, data });
  return getGeneratedResume(userId, id);
}

// Accept or reject changes (M4), saved immediately. The content is updated in the same
// write, from its current state, so manual edits elsewhere are kept.
export async function decideChanges(
  userId: string,
  id: string,
  decisions: { id: string; status: "accepted" | "rejected" }[],
): Promise<GeneratedResumeDetail> {
  const row = await findOwn(userId, id);
  let content = row.generatedContent as ResumeContent;
  let changes = row.changes as ResumeChange[];
  try {
    for (const decision of decisions) {
      ({ content, changes } = setChangeStatus(content, row.originalContent as ResumeContent, changes, decision.id, decision.status));
    }
  } catch (error) {
    if (error instanceof ChangeSetError) {
      throw new HttpError(error.code === "change_not_found" ? 404 : 409, error.code, error.message);
    }
    throw error;
  }
  // Only this request's view of the row is used: a concurrent decision on the same
  // resume is rejected instead of being silently overwritten.
  const { count } = await prisma.generatedResume.updateMany({
    where: { id, updatedAt: row.updatedAt },
    data: { generatedContent: content as Prisma.InputJsonValue, changes: changes as unknown as Prisma.InputJsonValue },
  });
  if (count === 0) throw new HttpError(409, "conflict", "This resume was changed meanwhile, reload it");
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
