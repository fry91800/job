import { PARTS_BASE, page, type TemplateInput } from "./common";
import { FONT_FAMILY } from "./fonts";
import { contactList, languageList, plainList, resumeParts, section, skillsBlock, tagList } from "./parts";

// "contemporary": a light sidebar (photo, contact, skills as tags, languages, interests) on
// every page, the career in the main column with a teal accent. Clean and current: tech,
// marketing, services.
export function renderContemporary(input: TemplateInput): string {
  const p = resumeParts(input, { tech: "tags" });
  const { t } = p;
  const body = `<div class="band" aria-hidden="true"></div>
  <div class="sheet">
    <aside class="side clone">
      ${p.photo}
      ${section("contact", t.contact, contactList(p.contact))}
      ${section("skills", t.skills, skillsBlock(p, tagList))}
      ${section("languages", t.languages, languageList(p.languages))}
      ${section("certifications", t.certifications, p.certifications)}
      ${section("interests", t.interests, plainList(p.interests))}
    </aside>
    <main class="main clone">
      <header class="head">
        <h1>${p.name}</h1>
        ${p.title ? `<div class="role">${p.title}</div>` : ""}
      </header>
      ${section("summary", t.summary, p.summary)}
      ${section("experience", t.experience, p.experience)}
      ${section("projects", t.projects, p.projects)}
      ${section("education", t.education, p.education)}
    </main>
  </div>`;
  return page(p.language, input.content.basics.fullName, PARTS_BASE + STYLE, body, ["manrope"]);
}

const ACCENT = "#0f766e";
const SIDE = "64mm";
const STYLE = `
body { font-family: ${FONT_FAMILY.manrope}, sans-serif; font-size: 9.1pt; color: #1e293b; line-height: 1.5; }
/* The sidebar's colour on every page (fixed elements repeat on each printed page). */
.band { position: fixed; top: 0; bottom: 0; left: 0; width: ${SIDE}; background: #eef3f2; }
.sheet { position: relative; display: grid; grid-template-columns: ${SIDE} 1fr; }
.side { padding: 14mm 7mm 12mm 8mm; font-size: 8.6pt; }
.main { padding: 14mm 14mm 12mm 10mm; }
.photo { width: 34mm; height: 34mm; border-radius: 6mm; margin: 0 auto 7mm; }
h1 { margin: 0; font-size: 25pt; font-weight: 800; letter-spacing: -0.012em; line-height: 1.08; color: #0f172a; }
.role { margin-top: 2mm; font-size: 11.5pt; font-weight: 600; color: ${ACCENT}; }
.head { margin-bottom: 8mm; }
.section-title { font-size: 9pt; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; color: #0f172a; }
.main .section-title { display: flex; align-items: center; gap: 2.5mm; }
.main .section-title::after { content: ""; flex: 1; border-top: 0.25mm solid #cfdcda; }
.side .section { margin-top: 7mm; }
.side .section:first-of-type, .side .photo + .section { margin-top: 0; }
.side .section-title { color: ${ACCENT}; font-size: 8.2pt; }
.contact li { margin: 1.4mm 0; align-items: flex-start; word-break: break-word; }
.contact .icon { color: ${ACCENT}; margin-top: 0.4mm; }
.tags { gap: 1.4mm; }
.tag { background: #fff; border: 0.2mm solid #cfdcda; border-radius: 1.6mm; padding: 0.5mm 2mm; font-size: 8pt; }
.main .tag { background: #eef3f2; border: 0; color: #134e4a; font-size: 7.8pt; }
.subhead { font-weight: 700; font-size: 8pt; color: #475569; margin-bottom: 1.4mm; }
.languages li { padding: 0.8mm 0; }
.level { color: #64748b; }
.plain li { margin: 0.8mm 0; }
.side .entry + .entry { margin-top: 2mm; }
.side .entry-head { display: block; }
.side .entry-title { font-weight: 700; }
.side .entry-org, .side .entry-dates { color: #64748b; font-size: 8pt; }
.main .entry { padding-left: 3.5mm; border-left: 0.5mm solid #cfdcda; }
.main .entry + .entry { margin-top: 4.5mm; }
.entry-title { font-weight: 700; font-size: 10pt; color: #0f172a; }
.entry-org { color: ${ACCENT}; font-weight: 600; }
.entry-place { color: #64748b; font-weight: 500; }
.entry-dates { font-size: 8.2pt; color: #64748b; font-weight: 600; }
.bullets li::marker { color: ${ACCENT}; }
.tech { margin-top: 1.8mm; }
.summary { font-size: 9.6pt; color: #334155; }
`;
