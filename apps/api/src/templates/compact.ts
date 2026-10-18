import { PARTS_BASE, page, type TemplateInput } from "./common";
import { FONT_FAMILY } from "./fonts";
import { contactList, inlineList, languageList, resumeParts, section, skillsBlock } from "./parts";

// "compact": dense and orderly, made to fit a long career on one page: small type, tight
// spacing, the details in a right column, a blue accent. No photo. Engineers, experienced
// profiles.
export function renderCompact(input: TemplateInput): string {
  const p = resumeParts(input, { tech: "text" });
  const { t } = p;
  const body = `<div class="sheet clone">
    <header class="head">
      <div>
        <h1>${p.name}</h1>
        ${p.title ? `<div class="role">${p.title}</div>` : ""}
      </div>
      ${contactList(p.contact)}
    </header>
    ${p.summary ? `<div class="intro">${p.summary}</div>` : ""}
    <div class="cols">
      <main>
        ${section("experience", t.experience, p.experience)}
        ${section("projects", t.projects, p.projects)}
      </main>
      <aside>
        ${section("education", t.education, p.education)}
        ${section("skills", t.skills, skillsBlock(p, (items) => inlineList(items, ", ")))}
        ${section("languages", t.languages, languageList(p.languages))}
        ${section("certifications", t.certifications, p.certifications)}
        ${section("interests", t.interests, inlineList(p.interests, ", "))}
      </aside>
    </div>
  </div>`;
  return page(p.language, input.content.basics.fullName, PARTS_BASE + STYLE, body, ["inter"]);
}

const ACCENT = "#1d4ed8";
const STYLE = `
body { font-family: ${FONT_FAMILY.inter}, sans-serif; font-size: 8.5pt; color: #1f2937; line-height: 1.42; }
.sheet { padding: 11mm 12mm 10mm; }
.head { display: flex; justify-content: space-between; align-items: flex-end; gap: 8mm; padding-bottom: 3.5mm; border-bottom: 0.6mm solid ${ACCENT}; }
h1 { margin: 0; font-size: 19pt; font-weight: 700; letter-spacing: -0.015em; line-height: 1.1; color: #111827; }
.role { margin-top: 1mm; font-size: 10pt; font-weight: 500; color: ${ACCENT}; }
.head .contact { display: grid; grid-template-columns: auto auto; gap: 0.8mm 5mm; font-size: 7.8pt; color: #374151; }
.head .icon { color: ${ACCENT}; width: 2.8mm; height: 2.8mm; }
.intro { margin-top: 3.5mm; font-size: 8.8pt; color: #374151; }
.cols { display: grid; grid-template-columns: 1fr 56mm; gap: 0 7mm; margin-top: 5mm; }
.section { margin-top: 4.5mm; }
.section-title { font-size: 8.2pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: ${ACCENT}; margin-bottom: 2mm; padding-bottom: 0.8mm; border-bottom: 0.2mm solid #dbe3f0; }
.entry + .entry { margin-top: 2.8mm; }
.entry-title { font-weight: 650; font-size: 9pt; color: #111827; }
.entry-org { color: #374151; }
.entry-dates { font-size: 7.8pt; color: #6b7280; font-variant-numeric: tabular-nums; }
.bullets { margin-top: 0.8mm; padding-left: 3.4mm; }
.bullets li { margin: 0.3mm 0; }
.bullets li::marker { color: ${ACCENT}; }
.tech { margin-top: 0.8mm; font-size: 7.8pt; color: #6b7280; }
.tech-label { font-weight: 600; }
aside { font-size: 8.2pt; }
aside .entry-head { display: block; }
aside .entry + .entry { margin-top: 2mm; }
aside .entry-text { font-size: 7.9pt; color: #4b5563; }
.subhead { font-weight: 600; font-size: 7.8pt; color: #6b7280; margin-top: 1.8mm; margin-bottom: 0.4mm; }
.languages li { padding: 0.3mm 0; }
.level { color: #6b7280; }
`;
