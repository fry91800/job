import { dateRange, esc, formatDate, joinNonEmpty, labelsFor, safeUrl, type TemplateInput } from "./common";

// The resume as HTML pieces with the same markup for every template (built from these
// since the 2026-10 batch): templates choose where each piece goes and style the classes.
// Every value from the resume is escaped here.
//
//   <section class="section section-experience"><h2 class="section-title">…</h2>
//     <div class="section-body"><article class="entry">
//       <div class="entry-head"><div class="entry-main"><div class="entry-title">…</div>
//         <div class="entry-org">Company<span class="entry-place">Paris</span></div></div>
//         <div class="entry-dates">…</div></div>
//       <p class="entry-text">…</p><ul class="bullets"><li>…</li></ul><div class="tech">…</div>
//     </article></div></section>

// Small line icons (Lucide, ISC licence), drawn in the text colour.
const ICONS = {
  mail: '<path d="m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7"/><rect x="2" y="4" width="20" height="16" rx="2"/>',
  phone: '<path d="M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384"/>',
  place: '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
};
type IconName = keyof typeof ICONS;

export const icon = (name: IconName) =>
  `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

export type ContactItem = { icon: IconName; html: string };

// "janv. 2019 – févr. 2022" may only wrap after the dash, never inside a date.
const unbreakableDates = (dates: string) => dates.replace(/ – /g, "\u00a0–\u0001").replace(/ /g, "\u00a0").replace(/\u0001/g, " ");

export type Parts = ReturnType<typeof resumeParts>;

export function resumeParts({ content, language, photoDataUrl }: TemplateInput, options: { tech?: "tags" | "text" } = {}) {
  const t = labelsFor(language);
  const { basics } = content;

  const contact: ContactItem[] = [];
  if (basics.email) contact.push({ icon: "mail", html: `<a href="mailto:${esc(basics.email)}">${esc(basics.email)}</a>` });
  if (basics.phone) contact.push({ icon: "phone", html: esc(basics.phone) });
  const place = joinNonEmpty([basics.location?.city, basics.location?.country], ", ");
  if (place) contact.push({ icon: "place", html: esc(place) });
  for (const link of basics.links) {
    const url = safeUrl(link.url);
    contact.push({ icon: "link", html: url ? `<a href="${esc(url)}">${esc(link.label)}</a>` : esc(link.label) });
  }

  const tech = (items: string[]) => {
    if (!items.length) return "";
    if (options.tech === "tags") return `<div class="tech tags">${items.map((item) => `<span class="tag">${esc(item)}</span>`).join("")}</div>`;
    return `<div class="tech"><span class="tech-label">${esc(t.technologies)} :</span> ${esc(items.join(", "))}</div>`;
  };
  const bullets = (items: { text: string }[]) => (items.length ? `<ul class="bullets">${items.map((item) => `<li>${esc(item.text)}</li>`).join("")}</ul>` : "");
  const entry = (head: { title: string; org?: string; place?: string | null; dates?: string }, inner: string) => `<article class="entry">
    <div class="entry-head">
      <div class="entry-main"><div class="entry-title">${head.title}</div>${head.org ? `<div class="entry-org">${head.org}${head.place ? `<span class="entry-place">${esc(head.place)}</span>` : ""}</div>` : ""}</div>
      ${head.dates ? `<div class="entry-dates">${unbreakableDates(esc(head.dates))}</div>` : ""}
    </div>${inner}</article>`;

  const experience = content.workExperience
    .map((job) => entry({ title: esc(job.jobTitle), org: esc(job.company), place: job.location, dates: dateRange(job, language) }, bullets(job.responsibilities) + tech(job.technologies)))
    .join("");

  const projects = content.projects
    .map((project) => {
      const link = project.link ? safeUrl(project.link) : null;
      const linkHtml = link ? `<a href="${esc(link)}">${esc(link.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, ""))}</a>` : "";
      return entry(
        { title: esc(project.name), org: linkHtml || undefined },
        (project.description ? `<p class="entry-text">${esc(project.description)}</p>` : "") + bullets(project.highlights) + tech(project.technologies),
      );
    })
    .join("");

  const education = content.education
    .map((item) => entry({ title: esc(item.degree), org: esc(item.institution), place: item.location, dates: dateRange(item, language) }, item.description ? `<p class="entry-text">${esc(item.description)}</p>` : ""))
    .join("");

  const certifications = content.certifications
    .map((item) => entry({ title: esc(item.name), org: item.issuer ? esc(item.issuer) : undefined, dates: item.date ? formatDate(item.date, language) : undefined }, ""))
    .join("");

  return {
    t,
    language,
    name: esc(basics.fullName),
    title: basics.title ? esc(basics.title) : "",
    photo: photoDataUrl ? `<img class="photo" src="${photoDataUrl}" alt="">` : "",
    hasPhoto: !!photoDataUrl,
    contact,
    summary: content.summary ? `<p class="summary">${esc(content.summary)}</p>` : "",
    experience,
    projects,
    education,
    certifications,
    technical: content.skills.filter((skill) => skill.category === "technical").map((skill) => esc(skill.name)),
    soft: content.skills.filter((skill) => skill.category === "soft").map((skill) => esc(skill.name)),
    languages: content.languages.map((item) => ({ name: esc(item.language), level: item.level ? esc(item.level) : "" })),
    interests: content.interests.map(esc),
  };
}

// A section, or nothing when its content is empty.
export function section(key: string, title: string, body: string): string {
  return body ? `<section class="section section-${key}"><h2 class="section-title">${esc(title)}</h2><div class="section-body">${body}</div></section>` : "";
}

export function contactList(items: ContactItem[], options: { icons?: boolean } = {}): string {
  return items.length
    ? `<ul class="contact">${items.map((item) => `<li>${options.icons === false ? "" : icon(item.icon)}<span>${item.html}</span></li>`).join("")}</ul>`
    : "";
}

export const tagList = (items: string[]) => (items.length ? `<div class="tags">${items.map((item) => `<span class="tag">${item}</span>`).join("")}</div>` : "");
export const inlineList = (items: string[], separator = " · ") => (items.length ? `<p class="inline-list">${items.join(`<span class="sep">${separator}</span>`)}</p>` : "");
export const plainList = (items: string[]) => (items.length ? `<ul class="plain">${items.map((item) => `<li>${item}</li>`).join("")}</ul>` : "");

export function languageList(items: { name: string; level: string }[]): string {
  return items.length
    ? `<ul class="languages">${items.map((item) => `<li><span class="language">${item.name}</span>${item.level ? `<span class="level">${item.level}</span>` : ""}</li>`).join("")}</ul>`
    : "";
}

// Skills: technical, then soft ones under their own label.
export function skillsBlock(parts: Parts, render: (items: string[]) => string): string {
  return joinNonEmpty([render(parts.technical), parts.soft.length ? `<div class="subhead">${esc(parts.t.softSkills)}</div>${render(parts.soft)}` : ""], "");
}
