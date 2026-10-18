import { PARTS_BASE, page, type TemplateInput } from "./common";
import { FONT_FAMILY } from "./fonts";
import { contactList, inlineList, languageList, resumeParts, section, skillsBlock } from "./parts";

// "elegant": one centred column in a book serif, small capitals, thin rules, a warm dark
// red accent; optional round photo above the name. Traditional sectors, law, culture,
// management.
export function renderElegant(input: TemplateInput): string {
  const p = resumeParts(input);
  const { t } = p;
  const body = `<div class="sheet clone">
    <header class="head">
      ${p.photo}
      <h1>${p.name}</h1>
      ${p.title ? `<div class="role">${p.title}</div>` : ""}
      ${contactList(p.contact, { icons: false })}
    </header>
    ${section("summary", t.summary, p.summary)}
    ${section("experience", t.experience, p.experience)}
    ${section("projects", t.projects, p.projects)}
    ${section("education", t.education, p.education)}
    ${section("skills", t.skills, skillsBlock(p, (items) => inlineList(items)))}
    <div class="duo">
      ${section("languages", t.languages, languageList(p.languages))}
      ${section("certifications", t.certifications, p.certifications)}
    </div>
    ${section("interests", t.interests, inlineList(p.interests))}
  </div>`;
  return page(p.language, input.content.basics.fullName, PARTS_BASE + STYLE, body, ["source-serif-4", "inter"]);
}

const ACCENT = "#7a2e2e";
const STYLE = `
body { font-family: ${FONT_FAMILY["source-serif-4"]}, serif; font-size: 10pt; color: #262321; line-height: 1.5; }
.sheet { padding: 15mm 20mm 14mm; }
.head { text-align: center; padding-bottom: 5mm; margin-bottom: 6mm; border-bottom: 1.1mm double #262321; }
.photo { width: 26mm; height: 26mm; border-radius: 50%; margin: 0 auto 4mm; }
h1 { margin: 0; font-size: 25pt; font-weight: 500; letter-spacing: 0.03em; line-height: 1.15; }
.role { margin-top: 1.5mm; font-size: 11pt; font-style: italic; color: ${ACCENT}; }
.contact { display: flex; justify-content: center; flex-wrap: wrap; gap: 1mm 0; margin-top: 3mm;
  font-family: ${FONT_FAMILY.inter}, sans-serif; font-size: 8.3pt; color: #57514c; }
.contact li + li::before { content: "·"; margin: 0 2.4mm; color: #a39a92; }
.section { margin-top: 6mm; }
.section-title { display: flex; align-items: center; gap: 3mm; font-size: 9.5pt; font-weight: 600; font-variant: small-caps;
  text-transform: lowercase; letter-spacing: 0.07em; color: ${ACCENT}; }
.section-title::before, .section-title::after { content: ""; flex: 1; border-top: 0.15mm solid #cbbfb4; }
.entry-title { font-weight: 600; font-size: 10.5pt; }
.entry-org { font-style: italic; color: #4a4440; }
.entry-place::before { content: ", "; }
.entry-dates { font-family: ${FONT_FAMILY.inter}, sans-serif; font-size: 8.3pt; color: #6b625b; letter-spacing: 0.02em; }
.bullets li::marker { color: ${ACCENT}; }
.tech { font-size: 8.8pt; color: #6b625b; }
.tech-label { font-style: italic; }
.summary { font-size: 10.3pt; text-align: center; font-style: italic; color: #3b3632; margin: 0 6mm; }
.inline-list { text-align: center; }
.inline-list .sep { color: #a39a92; margin: 0 0.6mm; }
.subhead { text-align: center; font-style: italic; color: #6b625b; margin-bottom: 0.6mm; }
.duo { display: grid; grid-template-columns: 1fr 1fr; gap: 0 10mm; }
.duo .section { margin-top: 6mm; }
.languages li { border-bottom: 0.15mm dotted #cbbfb4; padding: 0.6mm 0; }
.level { color: #6b625b; font-style: italic; }
.section-certifications .entry + .entry { margin-top: 1.5mm; }
.section-certifications .entry-head { display: block; }
`;
