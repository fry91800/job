// Offer descriptions are simplified Markdown (DATABASE.md "Offer description format"):
// "## " headings, "- " lists, **bold**, *italic*, [links](https://…), paragraphs. Rendered
// as React elements in the web app, and as escaped HTML for the offer pages sent to search
// engines (markdownToHtml): any HTML in the text stays text (descriptions come from
// external sites). Older descriptions may have a list dash alone on its line, with the
// item's text on the next one: both lines make one item.

export type Block = { type: "heading"; text: string } | { type: "list"; ordered: boolean; items: string[] } | { type: "paragraph"; lines: string[] };

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const LONE_MARKER = /^\s*([-*•]|\d+[.)])\s*$/;

export function parseMarkdown(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (!line.trim()) continue;
    const heading = /^\s*#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ type: "heading", text: heading[1].trim() });
      continue;
    }
    let item: string | null = null;
    let ordered = false;
    const bullet = BULLET.exec(line);
    const numbered = NUMBERED.exec(line);
    if (bullet) item = bullet[1];
    else if (numbered) {
      item = numbered[1];
      ordered = true;
    } else if (LONE_MARKER.test(line)) {
      // "-" alone: the next non-empty line is the item.
      ordered = /\d/.test(line);
      while (index + 1 < lines.length && !lines[index + 1].trim()) index++;
      item = lines[index + 1]?.trim() ?? "";
      index++;
    }
    if (item !== null) {
      const last = blocks.at(-1);
      if (last?.type === "list" && last.ordered === ordered) last.items.push(item.trim());
      else blocks.push({ type: "list", ordered, items: [item.trim()] });
      continue;
    }
    const last = blocks.at(-1);
    const previousBlank = index === 0 || !lines[index - 1].trim();
    if (last?.type === "paragraph" && !previousBlank) last.lines.push(line.trim());
    else blocks.push({ type: "paragraph", lines: [line.trim()] });
  }
  return blocks;
}


// The same text as HTML, for pages rendered on the server (offer pages for search engines,
// SEO): escaped, links marked nofollow. The web app renders it with React (Markdown.tsx).
const INLINE = /\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|_([^_\s][^_]*)_|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;

export const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

function inlineHtml(text: string): string {
  let html = "";
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    html += escapeHtml(text.slice(last, match.index));
    if (match[1] !== undefined) html += `<strong>${escapeHtml(match[1])}</strong>`;
    else if (match[2] !== undefined || match[3] !== undefined) html += `<em>${escapeHtml(match[2] ?? match[3])}</em>`;
    else html += `<a href="${escapeHtml(match[5])}" rel="nofollow noopener">${escapeHtml(match[4])}</a>`;
    last = match.index + match[0].length;
  }
  return html + escapeHtml(text.slice(last));
}

export function markdownToHtml(text: string, headingLevel = 2): string {
  return parseMarkdown(text)
    .map((block) => {
      if (block.type === "heading") return `<h${headingLevel}>${inlineHtml(block.text)}</h${headingLevel}>`;
      if (block.type === "list") {
        const tag = block.ordered ? "ol" : "ul";
        return `<${tag}>${block.items.map((item) => `<li>${inlineHtml(item)}</li>`).join("")}</${tag}>`;
      }
      return `<p>${block.lines.map(inlineHtml).join("<br>")}</p>`;
    })
    .join("\n");
}
