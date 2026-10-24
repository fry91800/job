import type { CoverLetterRecipient, CoverLetterSender } from "@job/shared";
import { esc } from "./common";
import { fontCss, FONT_FAMILY } from "./fonts";

// A cover letter as a printable page (FEATURE M5): the sender's block, the recipient, the
// place and date, the subject, then the text and the signature — the usual French layout,
// one A4 page. Every value is escaped; the page has no script and no external resource.

export type LetterInput = { language: string; subject: string; body: string; sender: CoverLetterSender; recipient: CoverLetterRecipient; date: Date };

const lines = (values: (string | null | undefined)[]) => values.filter((value): value is string => !!value?.trim()).map(esc).join("<br>");

export function renderLetterHtml(input: LetterInput): string {
  const fr = input.language === "fr";
  const date = new Intl.DateTimeFormat(fr ? "fr-FR" : "en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris" }).format(input.date);
  // "Lyon, le 24 octobre 2026": the town only (the header has the full place).
  const town = input.sender.location?.split(",")[0].trim() || null;
  const placeAndDate = fr ? `${town ? `${esc(town)}, le ` : "Le "}${esc(date)}` : `${town ? `${esc(town)}, ` : ""}${esc(date)}`;
  const paragraphs = input.body
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${esc(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
  return `<!doctype html>
<html lang="${fr ? "fr" : "en"}">
<head>
<meta charset="utf-8">
<title>${esc(input.subject)}</title>
<style>
${fontCss(["inter"])}
@page { size: A4; margin: 22mm 22mm 20mm; }
* { box-sizing: border-box; }
body { margin: 0; font-family: ${FONT_FAMILY.inter}; font-size: 10.5pt; line-height: 1.55; color: #1f2328; }
.sender { margin-bottom: 14mm; }
.sender .name { font-size: 13pt; font-weight: 600; }
.sender .title { color: #57606a; }
.recipient { margin-left: 55%; margin-bottom: 10mm; }
.date { margin-left: 55%; margin-bottom: 10mm; }
.subject { font-weight: 600; margin-bottom: 8mm; }
p { margin: 0 0 4mm; text-align: justify; hyphens: auto; }
.signature { margin-top: 10mm; margin-left: 55%; font-weight: 600; }
/* On screen (the app's preview), the page's margins, which only print uses. */
@media screen { body { max-width: 210mm; margin: 0 auto; padding: 18mm 20mm; } }
</style>
</head>
<body>
<div class="sender">
  ${input.sender.name ? `<div class="name">${esc(input.sender.name)}</div>` : ""}
  ${input.sender.title ? `<div class="title">${esc(input.sender.title)}</div>` : ""}
  <div>${lines([input.sender.location, input.sender.phone, input.sender.email])}</div>
</div>
${input.recipient.company || input.recipient.place ? `<div class="recipient">${lines([input.recipient.company, input.recipient.place])}</div>` : ""}
<div class="date">${placeAndDate}</div>
<div class="subject">${fr ? "Objet" : "Subject"} : ${esc(input.subject)}</div>
${paragraphs}
${input.sender.name ? `<div class="signature">${esc(input.sender.name)}</div>` : ""}
</body>
</html>`;
}
