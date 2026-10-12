import type { ResumeContent } from "@job/shared";

// Shared helpers for the resume templates. Templates print their headings in the
// RESUME's language, not the UI language (FEATURE L1).

export type TemplateInput = {
  content: ResumeContent;
  language: string;
  photoDataUrl: string | null; // only passed to templates that support photos
};

const labels = {
  fr: {
    summary: "Profil", experience: "Expérience professionnelle", projects: "Projets", education: "Formation",
    skills: "Compétences", softSkills: "Savoir-être", languages: "Langues", certifications: "Certifications",
    interests: "Centres d'intérêt", present: "aujourd'hui", technologies: "Technologies", contact: "Contact",
  },
  en: {
    summary: "Summary", experience: "Work experience", projects: "Projects", education: "Education",
    skills: "Skills", softSkills: "Soft skills", languages: "Languages", certifications: "Certifications",
    interests: "Interests", present: "present", technologies: "Technologies", contact: "Contact",
  },
};

export function labelsFor(language: string) {
  return language === "fr" ? labels.fr : labels.en;
}

// Every value from the resume goes through this before reaching the HTML.
export function esc(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Only http(s) and mailto links become clickable.
export function safeUrl(url: string): string | null {
  return /^(https?:\/\/|mailto:)/i.test(url.trim()) ? url.trim() : null;
}

// "2023-01" → "janv. 2023" / "Jan 2023"; "2023" → "2023".
export function formatDate(date: string | null, language: string): string {
  if (!date) return "";
  const [year, month] = date.split("-");
  if (!month) return year;
  return new Intl.DateTimeFormat(language === "fr" ? "fr-FR" : "en-GB", { month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(Number(year), Number(month) - 1, 1)),
  );
}

export function dateRange(item: { startDate: string | null; endDate: string | null; isCurrent?: boolean }, language: string): string {
  const start = formatDate(item.startDate, language);
  const end = item.isCurrent ? labelsFor(language).present : formatDate(item.endDate, language);
  if (start && end) return `${start} – ${end}`;
  return start || end;
}

export function joinNonEmpty(values: (string | null | undefined)[], separator: string): string {
  return values.filter((value): value is string => !!value).join(separator);
}

export function page(language: string, title: string, style: string, body: string): string {
  return `<!doctype html>
<html lang="${esc(language)}">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<style>
@page { size: A4; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
ul { margin: 4px 0 0; padding-left: 18px; }
li { margin: 2px 0; }
a { color: inherit; }
${style}
</style>
</head>
<body>${body}</body>
</html>`;
}
