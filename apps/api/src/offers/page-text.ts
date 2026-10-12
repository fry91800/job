import { HTMLElement, Node, NodeType, parse, TextNode } from "node-html-parser";

// Readable content of an offer page for the AI (O5): simplified Markdown of the main
// content (headings, lists, paragraphs) and the page's schema.org JobPosting data, which
// many job sites embed and which is the most reliable source of the fields.

const MAX_TEXT = 40000;
const REMOVED = "script, style, noscript, svg, iframe, template, nav, footer, aside, form, button, select, dialog";
const BLOCKS = new Set(["p", "div", "section", "article", "main", "header", "ul", "ol", "table", "tr", "dl", "dd", "dt", "blockquote", "pre", "br", "hr"]);

export type PageContent = { title: string | null; text: string; jobPostings: unknown[] };

function jobPostingsFrom(value: unknown, found: unknown[]): void {
  if (Array.isArray(value)) return value.forEach((item) => jobPostingsFrom(item, found));
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  const type = record["@type"];
  if (type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"))) found.push(record);
  if (record["@graph"]) jobPostingsFrom(record["@graph"], found);
}

function toMarkdown(node: Node, out: string[]): void {
  if (node.nodeType === NodeType.TEXT_NODE) {
    out.push((node as TextNode).text.replace(/\s+/g, " "));
    return;
  }
  if (node.nodeType !== NodeType.ELEMENT_NODE) return;
  const element = node as HTMLElement;
  const tag = element.tagName?.toLowerCase() ?? "";

  if (/^h[1-6]$/.test(tag)) {
    out.push(`\n\n## ${element.text.replace(/\s+/g, " ").trim()}\n\n`);
    return;
  }
  if (tag === "li") {
    out.push("\n- ");
    element.childNodes.forEach((child) => toMarkdown(child, out));
    return;
  }
  const block = BLOCKS.has(tag);
  if (block) out.push("\n");
  if (tag === "strong" || tag === "b") out.push("**");
  element.childNodes.forEach((child) => toMarkdown(child, out));
  if (tag === "strong" || tag === "b") out.push("**");
  if (block) out.push("\n");
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
  root.querySelectorAll(REMOVED).forEach((element) => element.remove());

  // The <main> or <article> element when it holds the content, else the whole body.
  const candidates = [root.querySelector("main"), root.querySelector("article"), root.querySelector("body"), root];
  const container = candidates.find((element) => element && element.text.trim().length > 300) ?? root.querySelector("body") ?? root;

  const out: string[] = [];
  toMarkdown(container, out);
  const text = out
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\*\*\s*\*\*/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_TEXT);

  return { title, text, jobPostings };
}
