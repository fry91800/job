import { dateRange, esc, formatDate, joinNonEmpty, labelsFor, page, safeUrl, type TemplateInput } from "./common";

// "modern": coloured sidebar (contact, skills, languages) and main column. No photo.
export function renderModern({ content, language }: TemplateInput): string {
  const t = labelsFor(language);
  const { basics } = content;
  const side = (title: string, html: string) => (html ? `<section><h3>${esc(title)}</h3>${html}</section>` : "");
  const main = (title: string, html: string) => (html ? `<section><h2>${esc(title)}</h2>${html}</section>` : "");
  const list = (items: string[]) => (items.length ? `<ul class="plain">${items.map((item) => `<li>${item}</li>`).join("")}</ul>` : "");

  const contact = list([
    esc(basics.email),
    esc(basics.phone),
    esc(joinNonEmpty([basics.location?.city, basics.location?.region, basics.location?.country], ", ")),
    ...basics.links.map((link) => {
      const url = safeUrl(link.url);
      return url ? `<a href="${esc(url)}">${esc(link.label)}</a>` : esc(link.label);
    }),
  ].filter(Boolean));

  const experience = content.workExperience
    .map(
      (job) => `<div class="entry">
        <div class="dates">${esc(dateRange(job, language))}</div>
        <div><strong>${esc(job.jobTitle)}</strong> · ${esc(job.company)}${job.location ? ` · ${esc(job.location)}` : ""}</div>
        ${job.responsibilities.length ? `<ul>${job.responsibilities.map((item) => `<li>${esc(item.text)}</li>`).join("")}</ul>` : ""}
        ${job.technologies.length ? `<div class="tags">${job.technologies.map((tech) => `<span>${esc(tech)}</span>`).join("")}</div>` : ""}
      </div>`,
    )
    .join("");

  const projects = content.projects
    .map((project) => {
      const link = project.link ? safeUrl(project.link) : null;
      return `<div class="entry">
        <div><strong>${link ? `<a href="${esc(link)}">${esc(project.name)}</a>` : esc(project.name)}</strong></div>
        ${project.description ? `<p>${esc(project.description)}</p>` : ""}
        ${project.highlights.length ? `<ul>${project.highlights.map((item) => `<li>${esc(item.text)}</li>`).join("")}</ul>` : ""}
        ${project.technologies.length ? `<div class="tags">${project.technologies.map((tech) => `<span>${esc(tech)}</span>`).join("")}</div>` : ""}
      </div>`;
    })
    .join("");

  const education = content.education
    .map(
      (item) => `<div class="entry">
        <div class="dates">${esc(dateRange(item, language))}</div>
        <div><strong>${esc(item.degree)}</strong> · ${esc(item.institution)}</div>
        ${item.description ? `<p>${esc(item.description)}</p>` : ""}
      </div>`,
    )
    .join("");

  const body = `<div class="sheet">
    <aside>
      <h1>${esc(basics.fullName)}</h1>
      ${basics.title ? `<div class="title">${esc(basics.title)}</div>` : ""}
      ${side(t.contact, contact)}
      ${side(t.skills, list(content.skills.filter((skill) => skill.category === "technical").map((skill) => esc(skill.name))))}
      ${side(t.softSkills, list(content.skills.filter((skill) => skill.category === "soft").map((skill) => esc(skill.name))))}
      ${side(t.languages, list(content.languages.map((item) => `${esc(item.language)}${item.level ? ` — ${esc(item.level)}` : ""}`)))}
      ${side(t.interests, list(content.interests.map(esc)))}
    </aside>
    <main>
      ${main(t.summary, content.summary ? `<p>${esc(content.summary)}</p>` : "")}
      ${main(t.experience, experience)}
      ${main(t.projects, projects)}
      ${main(t.education, education)}
      ${main(t.certifications, content.certifications.map((item) => `<div>${esc(item.name)}${item.issuer ? ` · ${esc(item.issuer)}` : ""}${item.date ? ` · ${esc(formatDate(item.date, language))}` : ""}</div>`).join(""))}
    </main>
  </div>`;

  return page(language, basics.fullName, STYLE, body);
}

const STYLE = `
body { font-family: "DejaVu Sans", Arial, sans-serif; font-size: 9.5pt; color: #1f2933; line-height: 1.4; }
.sheet { display: grid; grid-template-columns: 62mm 1fr; min-height: 297mm; }
aside { background: #1f3a5f; color: #fff; padding: 14mm 7mm; }
aside h1 { font-size: 17pt; margin: 0; line-height: 1.15; }
aside .title { margin-top: 4px; color: #c9d8ea; }
aside h3 { font-size: 9pt; text-transform: uppercase; letter-spacing: 1px; color: #c9d8ea; margin: 14px 0 4px; }
ul.plain { list-style: none; padding: 0; margin: 0; }
ul.plain li { margin: 2px 0; word-break: break-word; }
main { padding: 14mm 10mm; }
main h2 { font-size: 11pt; text-transform: uppercase; letter-spacing: 1px; color: #1f3a5f; border-bottom: 2px solid #1f3a5f; padding-bottom: 2px; margin: 0 0 6px; }
main section { margin-bottom: 12px; }
.entry { margin-bottom: 8px; break-inside: avoid; }
.dates { font-size: 8.5pt; color: #52606d; }
p { margin: 3px 0; }
.tags { margin-top: 3px; }
.tags span { display: inline-block; background: #e4ebf3; color: #1f3a5f; border-radius: 3px; padding: 0 5px; margin: 0 3px 3px 0; font-size: 8pt; }
`;
