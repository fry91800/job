import { HTMLElement, Node, NodeType, parse, TextNode } from "node-html-parser";

// HTML → simplified Markdown (DATABASE.md "Offer description format"): "## " headings,
// "- " lists, **bold**, paragraphs. Everything else becomes plain text; scripts, styles
// and page furniture (navigation, forms…) are dropped.

export const NON_CONTENT = "script, style, noscript, svg, iframe, template, nav, footer, aside, form, button, select, dialog";
const BLOCKS = new Set(["p", "div", "section", "article", "main", "header", "ul", "ol", "table", "tr", "dl", "dd", "dt", "blockquote", "pre", "br", "hr"]);

function walk(node: Node, out: string[]): void {
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
    element.childNodes.forEach((child) => walk(child, out));
    return;
  }
  const block = BLOCKS.has(tag);
  if (block) out.push("\n");
  if (tag === "strong" || tag === "b") out.push("**");
  element.childNodes.forEach((child) => walk(child, out));
  if (tag === "strong" || tag === "b") out.push("**");
  if (block) out.push("\n");
}

export function elementToMarkdown(node: Node): string {
  const out: string[] = [];
  walk(node, out);
  return out
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\*\*\s*\*\*/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// An HTML fragment (e.g. an offer description from an API) as simplified Markdown.
export function htmlToMarkdown(html: string): string {
  const root = parse(html, { comment: false });
  root.querySelectorAll(NON_CONTENT).forEach((element) => element.remove());
  return elementToMarkdown(root);
}
