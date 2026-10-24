import type { Prisma } from "@prisma/client";
import type { CoverLetterDetail, CoverLetterListItem, CoverLetterListResponse, CoverLetterRecipient, CoverLetterSender, ResumeContent } from "@job/shared";
import { consumeAiRateLimit } from "../ai/rate-limit";
import { config } from "../config";
import { HttpError } from "../lib/http-error";
import { prisma } from "../lib/prisma";
import { visibleOfferWhere } from "../offers/offer-access";
import { saveOffer } from "../saved-offers/saved-offers";
import { renderLetterHtml } from "../templates/letter";
import { renderPdf } from "../templates/pdf";
import { COVER_LETTER_PROMPT_VERSION, PLACEHOLDER, writeLetter } from "./letter-writer";

// Cover letters (FEATURE M5): written by the AI from a resume and an offer, in the offer's
// language (French or English, else the resume's), then edited by the user; rendered as a
// one-page PDF on demand. Counted for the quotas like generated resumes, deleted ones
// included.

type SessionUser = { id: string; isGuest: boolean };

export const coverLetterNotFound = () => new HttpError(404, "cover_letter_not_found", "Cover letter not found");

const include = {
  offer: { select: { id: true, title: true, companyName: true } },
  resume: { select: { id: true, name: true } },
} satisfies Prisma.CoverLetterInclude;

type Row = Prisma.CoverLetterGetPayload<{ include: typeof include }>;

const CONTRACTS: Record<string, Record<string, string>> = {
  fr: { permanent: "CDI", fixed_term: "CDD", temporary: "Intérim", freelance: "Freelance", internship: "Stage", apprenticeship: "Alternance" },
  en: { permanent: "Permanent", fixed_term: "Fixed-term", temporary: "Temporary", freelance: "Freelance", internship: "Internship", apprenticeship: "Apprenticeship" },
};

function toListItem(row: Row): CoverLetterListItem {
  return { id: row.id, offer: row.offer, resume: row.resume, language: row.language, subject: row.subject, createdAt: row.createdAt.toISOString() };
}

function toDetail(row: Row): CoverLetterDetail {
  return { ...toListItem(row), body: row.body, sender: row.sender as CoverLetterSender, recipient: row.recipient as CoverLetterRecipient, updatedAt: row.updatedAt.toISOString() };
}

async function findOwn(userId: string, id: string): Promise<Row> {
  const row = await prisma.coverLetter.findFirst({ where: { id, userId, deletedAt: null }, include });
  if (!row) throw coverLetterNotFound();
  return row;
}

async function checkQuota(user: SessionUser): Promise<void> {
  const { guestTotal, registeredPerDay } = config.limits.coverLetters;
  const since = user.isGuest ? undefined : new Date(Date.now() - 24 * 3600 * 1000);
  const count = await prisma.coverLetter.count({ where: { userId: user.id, ...(since && { createdAt: { gte: since } }) } });
  if (count >= (user.isGuest ? guestTotal : registeredPerDay)) {
    throw new HttpError(429, "limit_reached", user.isGuest ? "Create an account to write more cover letters" : "Daily cover letter limit reached");
  }
}

export async function writeCoverLetter(user: SessionUser, input: { offerId: string; resumeId?: string }, ip: string): Promise<CoverLetterDetail> {
  const settings = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { selectedResumeId: true } });
  const resumeId = input.resumeId ?? settings.selectedResumeId;
  if (!resumeId) throw new HttpError(400, "no_resume", "Add or select a resume first");
  const resume = await prisma.resume.findFirst({ where: { id: resumeId, userId: user.id, deletedAt: null } });
  if (!resume) throw new HttpError(404, "resume_not_found", "Resume not found");
  const offer = await prisma.offer.findFirst({ where: { id: input.offerId, ...visibleOfferWhere(user.id) }, include: { location: true, company: { select: { name: true } } } });
  if (!offer) throw new HttpError(404, "offer_not_found", "Offer not found");

  await checkQuota(user);
  consumeAiRateLimit(ip);

  const language = offer.language === "fr" || offer.language === "en" ? offer.language : resume.language === "en" ? "en" : "fr";
  const content = resume.content as ResumeContent;
  const company = offer.company?.name ?? offer.companyName;
  const place = offer.location ? offer.location.name : null;
  const { letter, model } = await writeLetter({
    resume: content,
    language,
    offer: { title: offer.title, companyName: company, place, contract: offer.contractType ? (CONTRACTS[language][offer.contractType] ?? null) : null, description: offer.description },
  });
  const body = [letter.salutation, ...letter.paragraphs, letter.closing].join("\n\n");
  // Logged for prompt improvement, never the content: the user sees and edits the letter.
  if (PLACEHOLDER.test(body) || PLACEHOLDER.test(letter.subject)) console.warn("write-cover-letter: a placeholder was left in the letter");

  const location = content.basics.location;
  const sender: CoverLetterSender = {
    name: content.basics.fullName || null,
    title: content.basics.title,
    email: content.basics.email,
    phone: content.basics.phone,
    location: location ? ([location.city, location.country].filter(Boolean).join(", ") || null) : null,
  };
  const recipient: CoverLetterRecipient = { company, place };
  const row = await prisma.coverLetter.create({
    data: {
      userId: user.id,
      offerId: offer.id,
      resumeId: resume.id,
      language,
      subject: letter.subject,
      body,
      sender: sender as Prisma.InputJsonValue,
      recipient: recipient as Prisma.InputJsonValue,
      aiModel: model,
      promptVersion: COVER_LETTER_PROMPT_VERSION,
    },
    include,
  });

  // The offer is saved automatically, as for a generated resume; a full list doesn't block.
  try {
    await saveOffer(user, offer.id);
  } catch (error) {
    if (!(error instanceof HttpError && error.code === "limit_reached")) throw error;
  }
  return toDetail(row);
}

export async function listCoverLetters(userId: string, offerId?: string): Promise<CoverLetterListResponse> {
  const rows = await prisma.coverLetter.findMany({ where: { userId, deletedAt: null, ...(offerId && { offerId }) }, include, orderBy: [{ createdAt: "desc" }, { id: "asc" }] });
  return { results: rows.map(toListItem) };
}

export async function getCoverLetter(userId: string, id: string): Promise<CoverLetterDetail> {
  return toDetail(await findOwn(userId, id));
}

export async function updateCoverLetter(userId: string, id: string, input: { subject?: string; body?: string }): Promise<CoverLetterDetail> {
  await findOwn(userId, id);
  await prisma.coverLetter.update({ where: { id }, data: input });
  return getCoverLetter(userId, id);
}

// Soft delete: the letter still counts towards the quota.
export async function deleteCoverLetter(userId: string, id: string): Promise<void> {
  await findOwn(userId, id);
  await prisma.coverLetter.update({ where: { id }, data: { deletedAt: new Date() } });
}

export async function renderCoverLetterHtml(userId: string, id: string): Promise<string> {
  const row = await findOwn(userId, id);
  return renderLetterHtml({ language: row.language, subject: row.subject, body: row.body, sender: row.sender as CoverLetterSender, recipient: row.recipient as CoverLetterRecipient, date: row.updatedAt });
}

// File name: Lettre_{FullName}_{Company}_{yyyy-mm-dd}.pdf.
export async function renderCoverLetterPdf(userId: string, id: string) {
  const row = await findOwn(userId, id);
  const html = await renderCoverLetterHtml(userId, id);
  const part = (value: string | null) => (value ?? "").normalize("NFC").replace(/[^\p{L}\p{N}-]+/gu, "-").replace(/^-+|-+$/g, "");
  const fileName = [row.language === "fr" ? "Lettre" : "Letter", part((row.sender as CoverLetterSender).name), part(row.offer.companyName), new Date().toISOString().slice(0, 10)].filter(Boolean).join("_");
  return { pdf: await renderPdf(html), fileName: `${fileName}.pdf` };
}
