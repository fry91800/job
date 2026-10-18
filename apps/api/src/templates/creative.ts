import { PARTS_BASE, page, type TemplateInput } from "./common";
import { FONT_FAMILY } from "./fonts";
import { contactList, inlineList, languageList, resumeParts, section, skillsBlock, tagList } from "./parts";

// "creative": a confident violet accent, a large name, round photo with a coloured ring,
// the career as a timeline with the dates on the left, skills as coloured tags. Design,
// communication, startups, first jobs that want to stand out.
export function renderCreative(input: TemplateInput): string {
  const p = resumeParts(input, { tech: "tags" });
  const { t } = p;
  const body = `<div class="sheet clone">
    <header class="head">
      ${p.photo}
      <div class="who">
        <h1>${p.name}</h1>
        ${p.title ? `<div class="role">${p.title}</div>` : ""}
        ${contactList(p.contact)}
      </div>
    </header>
    ${section("summary", t.summary, p.summary)}
    ${section("experience", t.experience, p.experience)}
    ${section("projects", t.projects, p.projects)}
    ${section("education", t.education, p.education)}
    <div class="trio">
      ${section("skills", t.skills, skillsBlock(p, tagList))}
      <div>
        ${section("languages", t.languages, languageList(p.languages))}
        ${section("interests", t.interests, inlineList(p.interests))}
      </div>
    </div>
    ${section("certifications", t.certifications, p.certifications)}
  </div>`;
  return page(p.language, input.content.basics.fullName, PARTS_BASE + STYLE, body, ["manrope"]);
}

const ACCENT = "#6d28d9";
const SOFT = "#f1ebfd";
const STYLE = `
body { font-family: ${FONT_FAMILY.manrope}, sans-serif; font-size: 9.2pt; color: #1f1b2e; line-height: 1.5; }
.sheet { padding: 14mm 16mm 13mm; }
.head { display: flex; align-items: center; gap: 7mm; padding-bottom: 6mm; margin-bottom: 2mm; }
.photo { width: 30mm; height: 30mm; border-radius: 50%; box-shadow: 0 0 0 1.2mm #fff, 0 0 0 2.2mm ${ACCENT}; margin: 1.2mm; flex-shrink: 0; }
h1 { margin: 0; font-size: 29pt; font-weight: 800; letter-spacing: -0.012em; line-height: 1.02; color: #1f1b2e; }
.role { display: inline-block; margin-top: 2.5mm; font-size: 10.5pt; font-weight: 700; color: #fff; background: ${ACCENT}; border-radius: 1.6mm; padding: 0.6mm 2.6mm; }
.head .contact { display: flex; flex-wrap: wrap; gap: 1mm 4.5mm; margin-top: 3.5mm; font-size: 8.2pt; color: #4b4560; }
.head .icon { color: ${ACCENT}; }
.section { margin-top: 6mm; }
.section-title { display: flex; align-items: center; gap: 2.2mm; font-size: 10.5pt; font-weight: 800; color: #1f1b2e; letter-spacing: -0.01em; }
.section-title::before { content: ""; width: 2.4mm; height: 2.4mm; border-radius: 0.7mm; background: ${ACCENT}; }
.summary { font-size: 9.8pt; color: #3b3550; padding: 3mm 4mm; background: ${SOFT}; border-radius: 2mm; }
/* Timeline: dates on the left, a line with a dot per entry. */
.section-experience .entry, .section-education .entry, .section-projects .entry { position: relative; display: grid; grid-template-columns: 30mm 1fr; column-gap: 6mm; }
.section-experience .entry-head, .section-education .entry-head, .section-projects .entry-head { display: contents; }
.section-experience .entry-dates, .section-education .entry-dates { grid-column: 1; grid-row: 1 / span 4; text-align: right; padding-top: 0.5mm; white-space: normal; }
.section-experience .entry-main, .section-education .entry-main, .section-projects .entry-main { grid-column: 2; }
.section-experience .entry > :not(.entry-head), .section-education .entry > :not(.entry-head), .section-projects .entry > :not(.entry-head) { grid-column: 2; }
.section-experience .entry::before, .section-education .entry::before, .section-projects .entry::before { content: ""; position: absolute; left: 32.2mm; top: 1.3mm; width: 1.8mm; height: 1.8mm; border-radius: 50%; background: ${ACCENT}; }
.section-experience .entry::after, .section-education .entry::after, .section-projects .entry::after { content: ""; position: absolute; left: 33mm; top: 3.6mm; bottom: -3.6mm; border-left: 0.25mm solid #d9cdf5; }
.section-experience .entry:last-child::after, .section-education .entry:last-child::after, .section-projects .entry:last-child::after { display: none; }
.entry + .entry { margin-top: 4mm; }
.entry-title { font-weight: 800; font-size: 10pt; }
.entry-org { color: ${ACCENT}; font-weight: 700; }
.entry-place { color: #6b6480; font-weight: 500; }
.entry-dates { font-size: 8.2pt; font-weight: 700; color: #6b6480; }
.bullets li::marker { color: ${ACCENT}; }
.tag { background: ${SOFT}; color: #4c1d95; border-radius: 1.6mm; padding: 0.5mm 2.2mm; font-size: 8pt; font-weight: 600; }
.tech .tag { font-size: 7.6pt; padding: 0.3mm 1.8mm; }
.trio { display: grid; grid-template-columns: 1.4fr 1fr; gap: 0 10mm; margin-top: 6mm; }
.subhead { font-weight: 700; font-size: 8.2pt; color: #6b6480; margin-bottom: 1.4mm; }
.languages li { padding: 0.6mm 0; }
.level { color: #6b6480; }
.inline-list .sep { color: ${ACCENT}; margin: 0 0.8mm; }
.section-certifications .entry-head { display: flex; }
.section-certifications .entry + .entry { margin-top: 1.6mm; }
`;
