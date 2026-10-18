import { PARTS_BASE, page, type TemplateInput } from "./common";
import { FONT_FAMILY } from "./fonts";
import { contactList, languageList, plainList, resumeParts, section, skillsBlock } from "./parts";

// "executive": a deep navy band with the name in serif and a gold accent, then the career
// in a wide column and the qualifications in a narrow one. Senior profiles, finance,
// consulting, management.
export function renderExecutive(input: TemplateInput): string {
  const p = resumeParts(input, { tech: "text" });
  const { t } = p;
  const body = `<header class="band">
      <div class="who">
        <h1>${p.name}</h1>
        ${p.title ? `<div class="role">${p.title}</div>` : ""}
        ${contactList(p.contact)}
      </div>
      ${p.photo}
    </header>
    <div class="sheet clone">
      <main class="main">
        ${section("summary", t.summary, p.summary)}
        ${section("experience", t.experience, p.experience)}
        ${section("projects", t.projects, p.projects)}
      </main>
      <aside class="side">
        ${section("education", t.education, p.education)}
        ${section("skills", t.skills, skillsBlock(p, plainList))}
        ${section("languages", t.languages, languageList(p.languages))}
        ${section("certifications", t.certifications, p.certifications)}
        ${section("interests", t.interests, plainList(p.interests))}
      </aside>
    </div>`;
  return page(p.language, input.content.basics.fullName, PARTS_BASE + STYLE, body, ["source-serif-4", "inter"]);
}

const NAVY = "#15233b";
const GOLD = "#b08d57";
const STYLE = `
body { font-family: ${FONT_FAMILY.inter}, sans-serif; font-size: 9pt; color: #222831; line-height: 1.5; }
.band { display: flex; align-items: center; justify-content: space-between; gap: 8mm; background: ${NAVY}; color: #fff; padding: 13mm 16mm 11mm; }
h1 { margin: 0; font-family: ${FONT_FAMILY["source-serif-4"]}, serif; font-size: 27pt; font-weight: 600; line-height: 1.1; letter-spacing: 0.01em; }
.role { margin-top: 1.5mm; font-size: 10.5pt; color: #e6cf9f; letter-spacing: 0.02em; }
.band .contact { display: flex; flex-wrap: wrap; gap: 1.2mm 5mm; margin-top: 4.5mm; font-size: 8.2pt; color: #d5dbe5; }
.band .icon { color: ${GOLD}; }
.photo { width: 30mm; height: 30mm; border-radius: 50%; border: 0.8mm solid ${GOLD}; flex-shrink: 0; }
.sheet { display: grid; grid-template-columns: 1fr 58mm; gap: 0 9mm; padding: 9mm 16mm 13mm; }
.section { margin-top: 6.5mm; }
.section-title { font-family: ${FONT_FAMILY["source-serif-4"]}, serif; font-size: 12pt; font-weight: 600; color: ${NAVY}; padding-bottom: 1.2mm; border-bottom: 0.3mm solid ${GOLD}; }
.side .section-title { font-size: 11pt; }
.side { border-left: 0.2mm solid #e3e6eb; padding-left: 7mm; font-size: 8.6pt; }
.entry + .entry { margin-top: 4.2mm; }
.entry-title { font-weight: 650; font-size: 9.8pt; color: ${NAVY}; }
.entry-org { color: #4b5563; font-weight: 500; }
.entry-dates { font-size: 8pt; color: #6b7280; }
.bullets li::marker { color: ${GOLD}; }
.tech { font-size: 8.2pt; color: #6b7280; }
.summary { font-size: 9.6pt; color: #374151; }
.side .entry-head { display: block; }
.side .entry + .entry { margin-top: 2.4mm; }
.side .entry-title { font-size: 9pt; }
.side .entry-org, .side .entry-dates { font-size: 8.2pt; }
.side .entry-text { font-size: 8.2pt; color: #4b5563; }
.plain li { margin: 0.8mm 0; padding-left: 3mm; position: relative; }
.plain li::before { content: ""; position: absolute; left: 0; top: 2mm; width: 1.2mm; height: 0.25mm; background: ${GOLD}; }
.subhead { font-weight: 600; font-size: 8.2pt; color: #6b7280; margin-bottom: 0.6mm; }
.languages li { padding: 0.6mm 0; border-bottom: 0.2mm solid #eef0f3; }
.level { color: #6b7280; }
`;
