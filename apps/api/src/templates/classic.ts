import { dateRange, esc, formatDate, joinNonEmpty, labelsFor, page, safeUrl, type TemplateInput } from "./common";

// "classic": one column, serif headings, optional photo top right.
export function renderClassic({ content, language, photoDataUrl }: TemplateInput): string {
  const t = labelsFor(language);
  const { basics } = content;
  const section = (title: string, html: string) => (html ? `<section><h2>${esc(title)}</h2>${html}</section>` : "");

  const contact = joinNonEmpty(
    [
      esc(basics.email),
      esc(basics.phone),
      esc(joinNonEmpty([basics.location?.city, basics.location?.country], ", ")),
      ...basics.links.map((link) => {
        const url = safeUrl(link.url);
        return url ? `<a href="${esc(url)}">${esc(link.label)}</a>` : esc(link.label);
      }),
    ],
    " · ",
  );

  const experience = content.workExperience
    .map(
      (job) => `<div class="entry">
        <div class="entry-head"><span><strong>${esc(job.jobTitle)}</strong> — ${esc(job.company)}${job.location ? `, ${esc(job.location)}` : ""}</span>
        <span class="dates">${esc(dateRange(job, language))}</span></div>
        ${job.responsibilities.length ? `<ul>${job.responsibilities.map((item) => `<li>${esc(item.text)}</li>`).join("")}</ul>` : ""}
        ${job.technologies.length ? `<div class="tech">${esc(t.technologies)} : ${esc(job.technologies.join(", "))}</div>` : ""}
      </div>`,
    )
    .join("");

  const projects = content.projects
    .map((project) => {
      const link = project.link ? safeUrl(project.link) : null;
      return `<div class="entry">
        <div class="entry-head"><strong>${esc(project.name)}</strong>${link ? ` — <a href="${esc(link)}">${esc(link)}</a>` : ""}</div>
        ${project.description ? `<p>${esc(project.description)}</p>` : ""}
        ${project.highlights.length ? `<ul>${project.highlights.map((item) => `<li>${esc(item.text)}</li>`).join("")}</ul>` : ""}
        ${project.technologies.length ? `<div class="tech">${esc(t.technologies)} : ${esc(project.technologies.join(", "))}</div>` : ""}
      </div>`;
    })
    .join("");

  const education = content.education
    .map(
      (item) => `<div class="entry">
        <div class="entry-head"><span><strong>${esc(item.degree)}</strong> — ${esc(item.institution)}${item.location ? `, ${esc(item.location)}` : ""}</span>
        <span class="dates">${esc(dateRange(item, language))}</span></div>
        ${item.description ? `<p>${esc(item.description)}</p>` : ""}
      </div>`,
    )
    .join("");

  const technical = content.skills.filter((skill) => skill.category === "technical").map((skill) => esc(skill.name));
  const soft = content.skills.filter((skill) => skill.category === "soft").map((skill) => esc(skill.name));
  const skills = joinNonEmpty(
    [technical.length ? `<p>${technical.join(" · ")}</p>` : "", soft.length ? `<p><em>${esc(t.softSkills)} :</em> ${soft.join(" · ")}</p>` : ""],
    "",
  );

  const body = `<div class="sheet">
    <header>
      <div>
        <h1>${esc(basics.fullName)}</h1>
        ${basics.title ? `<div class="title">${esc(basics.title)}</div>` : ""}
        <div class="contact">${contact}</div>
      </div>
      ${photoDataUrl ? `<img class="photo" src="${photoDataUrl}" alt="">` : ""}
    </header>
    ${section(t.summary, content.summary ? `<p>${esc(content.summary)}</p>` : "")}
    ${section(t.experience, experience)}
    ${section(t.projects, projects)}
    ${section(t.education, education)}
    ${section(t.skills, skills)}
    ${section(t.languages, content.languages.map((item) => `${esc(item.language)}${item.level ? ` (${esc(item.level)})` : ""}`).join(" · "))}
    ${section(t.certifications, content.certifications.map((item) => `<div>${esc(item.name)}${item.issuer ? ` — ${esc(item.issuer)}` : ""}${item.date ? ` (${esc(formatDate(item.date, language))})` : ""}</div>`).join(""))}
    ${section(t.interests, esc(content.interests.join(" · ")))}
  </div>`;

  return page(language, basics.fullName, STYLE, body);
}

const STYLE = `
body { font-family: "DejaVu Serif", Georgia, serif; font-size: 10.5pt; color: #222; line-height: 1.35; }
.sheet { padding: 16mm 18mm; }
header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #222; padding-bottom: 8px; margin-bottom: 10px; }
h1 { margin: 0; font-size: 22pt; letter-spacing: 0.5px; }
.title { font-size: 12pt; margin-top: 2px; }
.contact { font-family: "DejaVu Sans", Arial, sans-serif; font-size: 9pt; color: #555; margin-top: 6px; }
.photo { width: 30mm; height: 30mm; object-fit: cover; border-radius: 4px; }
h2 { font-size: 11pt; text-transform: uppercase; letter-spacing: 1px; border-bottom: 1px solid #bbb; margin: 12px 0 6px; padding-bottom: 2px; }
p { margin: 4px 0; }
.entry { margin-bottom: 8px; break-inside: avoid; }
.entry-head { display: flex; justify-content: space-between; gap: 8px; }
.dates { color: #555; white-space: nowrap; font-size: 9.5pt; }
.tech { font-size: 9pt; color: #555; margin-top: 2px; }
`;
