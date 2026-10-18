import { PARTS_BASE, page, type TemplateInput } from "./common";
import { FONT_FAMILY } from "./fonts";
import { contactList, inlineList, languageList, resumeParts, section, skillsBlock } from "./parts";

// "minimal": Swiss style in black and greys, a lot of white space, no photo. One column of
// text in reading order: the safest for recruiters' software (which reads a page column by
// column, so a column of headings would end up away from its text).
export function renderMinimal(input: TemplateInput): string {
  const p = resumeParts(input, { tech: "text" });
  const { t } = p;
  const body = `<div class="sheet clone">
    <header class="head">
      <h1>${p.name}</h1>
      ${p.title ? `<div class="role">${p.title}</div>` : ""}
      ${contactList(p.contact)}
    </header>
    ${section("summary", t.summary, p.summary)}
    ${section("experience", t.experience, p.experience)}
    ${section("projects", t.projects, p.projects)}
    ${section("education", t.education, p.education)}
    ${section("skills", t.skills, skillsBlock(p, (items) => inlineList(items, ", ")))}
    ${section("languages", t.languages, languageList(p.languages))}
    ${section("certifications", t.certifications, p.certifications)}
    ${section("interests", t.interests, inlineList(p.interests, ", "))}
  </div>`;
  return page(p.language, input.content.basics.fullName, PARTS_BASE + STYLE, body, ["inter"]);
}

const STYLE = `
body { font-family: ${FONT_FAMILY.inter}, sans-serif; font-size: 9.2pt; color: #1c1c1c; line-height: 1.5; }
.sheet { padding: 17mm 18mm 15mm; }
.head { margin-bottom: 8mm; }
h1 { margin: 0; font-size: 24pt; font-weight: 650; letter-spacing: -0.012em; line-height: 1.1; }
.role { margin-top: 1.5mm; font-size: 11pt; color: #6b6b6b; font-weight: 400; }
.contact { display: flex; flex-wrap: wrap; gap: 1.2mm 5mm; margin-top: 4mm; font-size: 8.4pt; color: #3d3d3d; }
.contact .icon { color: #9a9a9a; width: 3mm; height: 3mm; }
.section { margin-top: 7mm; }
.section-title { display: flex; gap: 3mm; align-items: center; margin: 0 0 3mm; font-size: 7.8pt; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.06em; color: #8a8a8a; }
.section-title::after { content: ""; flex: 1; border-top: 0.2mm solid #e2e2e2; }
.entry + .entry { margin-top: 4mm; }
.entry-title { font-weight: 600; font-size: 9.8pt; }
.entry-org { color: #4a4a4a; }
.entry-dates { font-size: 8.2pt; color: #8a8a8a; font-variant-numeric: tabular-nums; }
.bullets { padding-left: 3.6mm; }
.bullets li::marker { content: "–  "; color: #9a9a9a; }
.tech { font-size: 8.4pt; color: #6b6b6b; }
.tech-label { color: #8a8a8a; }
.summary { font-size: 9.8pt; color: #2b2b2b; }
.subhead { font-size: 8.2pt; color: #8a8a8a; margin-bottom: 0.6mm; }
.languages li { justify-content: flex-start; gap: 2mm; }
.languages .level { color: #8a8a8a; }
.languages .level::before { content: "— "; }
.section-certifications .entry + .entry { margin-top: 1.6mm; }
`;
