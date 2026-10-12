import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";
import { HttpError } from "../lib/http-error";

// Text of an uploaded resume (FEATURE R2). The AI gets the text, not the file: cheaper,
// and the same path for PDF and DOCX.

export const MAX_RESUME_PAGES = 10;
const MIN_TEXT_LENGTH = 50;

const unreadable = () => new HttpError(422, "unreadable_file", "We couldn't read text from this file");

export async function extractResumeText(file: Buffer, type: "pdf" | "docx"): Promise<string> {
  const text = type === "pdf" ? await pdfText(file) : await docxText(file);
  const cleaned = text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  // Scanned PDFs have no text layer; OCR is out of scope.
  if (cleaned.length < MIN_TEXT_LENGTH) throw unreadable();
  return cleaned;
}

async function pdfText(file: Buffer): Promise<string> {
  let pdf;
  try {
    pdf = await getDocumentProxy(new Uint8Array(file));
  } catch (error) {
    if ((error as Error).name === "PasswordException") {
      throw new HttpError(422, "protected_file", "This file is password-protected");
    }
    throw unreadable();
  }
  if (pdf.numPages > MAX_RESUME_PAGES) {
    throw new HttpError(422, "too_many_pages", `A resume can have at most ${MAX_RESUME_PAGES} pages`);
  }
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

async function docxText(file: Buffer): Promise<string> {
  try {
    return (await mammoth.extractRawText({ buffer: file })).value;
  } catch {
    throw unreadable();
  }
}
