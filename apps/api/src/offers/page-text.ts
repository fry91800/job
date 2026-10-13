import { elementToMarkdown, NON_CONTENT } from "@job/backend";
import { parse } from "node-html-parser";

// Readable content of an offer page for the AI (O5): simplified Markdown of the main
// content (headings, lists, paragraphs) and the page's schema.org JobPosting data, which
// many job sites embed and which is the most reliable source of the fields.

const MAX_TEXT = 40000;

export type PageContent = { title: string | null; text: string; jobPostings: unknown[] };

function jobPostingsFrom(value: unknown, found: unknown[]): void {
  if (Array.isArray(value)) return value.forEach((item) => jobPostingsFrom(item, found));
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  const type = record["@type"];
  if (type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"))) found.push(record);
  if (record["@graph"]) jobPostingsFrom(record["@graph"], found);
}

export function pageContent(html: string): PageContent {
  const root = parse(html, { comment: false });

  const jobPostings: unknown[] = [];
  for (const script of root.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      jobPostingsFrom(JSON.parse(script.rawText), jobPostings);
    } catch {
      // Invalid JSON-LD: ignored.
    }
  }

  const title = root.querySelector("title")?.text.trim() || null;
  root.querySelectorAll(NON_CONTENT).forEach((element) => element.remove());

  // The <main> or <article> element when it holds the content, else the whole body.
  const candidates = [root.querySelector("main"), root.querySelector("article"), root.querySelector("body"), root];
  const container = candidates.find((element) => element && element.text.trim().length > 300) ?? root.querySelector("body") ?? root;

  const text = elementToMarkdown(container).slice(0, MAX_TEXT);

  return { title, text, jobPostings };
}
