import { readFileSync } from "node:fs";
import { join } from "node:path";
import { escapeHtml, markdownToHtml } from "@job/shared/src/markdown";
import { config } from "../config";
import { prisma } from "../lib/prisma";

// Offer pages for search engines (SEO.md): /offers/{id} answered with the web app's page
// (its built index.html) carrying the offer in HTML, its title, description and canonical
// address, and schema.org JobPosting (Google for Jobs). Everyone gets the same page: the
// app starts on top of it and shows the same offer. Closed offers: "no longer available",
// not indexed, no JobPosting. Private offers (added by users) and unknown ids: 404.

const CONTRACTS: Record<string, string> = { permanent: "CDI", fixed_term: "CDD", temporary: "Intérim", freelance: "Freelance", internship: "Stage", apprenticeship: "Alternance", other: "Autre contrat" };
const REMOTE: Record<string, string> = { remote: "Télétravail complet", hybrid: "Télétravail partiel", onsite: "Sur site" };
const EMPLOYMENT: Record<string, string> = { internship: "INTERN", temporary: "TEMPORARY", fixed_term: "TEMPORARY", freelance: "CONTRACTOR" };
const PERIODS: Record<string, string> = { hour: "HOUR", day: "DAY", month: "MONTH", year: "YEAR" };
const PERIOD_LABELS: Record<string, string> = { hour: "de l'heure", day: "par jour", month: "par mois", year: "par an" };

// Where an offer comes from, for the attribution line ("Source : …").
const SOURCE_NAMES: Record<string, string> = { choisirleservicepublic: "Choisir le service public", user: "" };

let template: string | null = null;

// The built web app's page (WEB_DIST_DIR); null in development (Vite serves the app).
export function appTemplate(): string | null {
  if (template !== null) return template;
  if (!config.seo.webDistDir) return null;
  template = readFileSync(join(config.seo.webDistDir, "index.html"), "utf8");
  return template;
}

// Tests.
export function resetAppTemplate(): void {
  template = null;
}

const offerInclude = {
  location: true,
  company: { select: { name: true, website: true } },
  sources: { where: { closedAt: null }, select: { source: true, url: true, applyUrl: true, expiresAt: true } },
  skills: { select: { skill: { select: { names: { where: { isCanonical: true, language: "fr" }, select: { name: true } } } } } },
} as const;

export async function loadPublicOffer(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return prisma.offer.findFirst({ where: { id, isPublic: true }, include: offerInclude });
}

type PublicOffer = NonNullable<Awaited<ReturnType<typeof loadPublicOffer>>>;

const money = (value: number) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(value);
const frenchDate = (date: Date) => new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris" }).format(date);

function salaryText(offer: PublicOffer): string | null {
  const { salaryMin: min, salaryMax: max, salaryCurrency: currency, salaryPeriod: period } = offer;
  if ((min === null && max === null) || !currency || !period) return null;
  const amount = min !== null && max !== null && min !== max ? `${money(min)} – ${money(max)}` : money((min ?? max)!);
  return `${amount} ${currency === "EUR" ? "€" : currency} ${PERIOD_LABELS[period] ?? ""}`.trim();
}

function placeText(offer: PublicOffer): string | null {
  const location = offer.location;
  if (!location) return null;
  return location.type === "city" && location.countyCode ? `${location.name} (${location.countyCode})` : location.name;
}

function plainText(markdown: string, length: number): string {
  const text = markdown.replace(/[#*_>`[\]()-]+/g, " ").replace(/\s+/g, " ").trim();
  return text.length > length ? `${text.slice(0, length - 1).trimEnd()}…` : text;
}

// schema.org JobPosting: only for open offers with a company and a place (or remote), as
// Google requires.
export function jobPosting(offer: PublicOffer, canonical: string): Record<string, unknown> | null {
  const company = offer.company?.name ?? offer.companyName;
  const remote = offer.remoteType === "remote";
  if (offer.closedAt || !company || (!offer.location && !remote)) return null;
  const expires = offer.sources.map((source) => source.expiresAt).filter((date): date is Date => !!date).sort((a, b) => a.getTime() - b.getTime())[0];
  const location = offer.location;
  return {
    "@context": "https://schema.org/",
    "@type": "JobPosting",
    title: offer.title,
    description: markdownToHtml(offer.description, 3),
    datePosted: (offer.publishedAt ?? offer.createdAt).toISOString(),
    ...(expires && { validThrough: expires.toISOString() }),
    ...(offer.contractType && EMPLOYMENT[offer.contractType] && { employmentType: EMPLOYMENT[offer.contractType] }),
    hiringOrganization: { "@type": "Organization", name: company, ...(offer.company?.website && { sameAs: offer.company.website }) },
    ...(location && {
      jobLocation: {
        "@type": "Place",
        address: {
          "@type": "PostalAddress",
          ...(location.type === "city" && { addressLocality: location.name }),
          ...(location.regionName && { addressRegion: location.regionName }),
          addressCountry: location.countryCode,
        },
      },
    }),
    ...(remote && { jobLocationType: "TELECOMMUTE", applicantLocationRequirements: { "@type": "Country", name: "France" } }),
    ...(offer.salaryCurrency && offer.salaryPeriod && (offer.salaryMin !== null || offer.salaryMax !== null) && {
      baseSalary: {
        "@type": "MonetaryAmount",
        currency: offer.salaryCurrency,
        value: { "@type": "QuantitativeValue", ...(offer.salaryMin !== null && { minValue: offer.salaryMin }), ...(offer.salaryMax !== null && { maxValue: offer.salaryMax }), unitText: PERIODS[offer.salaryPeriod] },
      },
    }),
    identifier: { "@type": "PropertyValue", name: config.seo.siteName, value: offer.id },
    url: canonical,
    directApply: false,
  };
}

// The offer as plain HTML (inside the app's root element, replaced when the app starts).
function offerArticle(offer: PublicOffer): string {
  const company = offer.company?.name ?? offer.companyName;
  const facts = [company, placeText(offer), offer.contractType && CONTRACTS[offer.contractType], offer.remoteType && REMOTE[offer.remoteType], salaryText(offer)].filter(Boolean) as string[];
  const published = offer.publishedAt ?? offer.createdAt;
  const source = offer.sources[0];
  const original = source?.url ?? offer.url;
  const sourceName = source && (SOURCE_NAMES[source.source] ?? (company ? `site carrières de ${company}` : null));
  const skills = offer.skills.map(({ skill }) => skill.names[0]?.name).filter(Boolean) as string[];
  return `<article class="seo-offer">
<p><a href="/">${escapeHtml(config.seo.siteName)}</a> › Offres d'emploi</p>
${offer.closedAt ? `<p class="seo-closed"><strong>Cette offre n'est plus disponible.</strong> <a href="/">Voir les offres du moment</a></p>` : ""}
<h1>${escapeHtml(offer.title)}</h1>
<p>${facts.map(escapeHtml).join(" · ")}</p>
<p>Publiée le ${escapeHtml(frenchDate(published))}</p>
${markdownToHtml(offer.description)}
${skills.length ? `<h2>Compétences</h2><ul>${skills.map((skill) => `<li>${escapeHtml(skill)}</li>`).join("")}</ul>` : ""}
${original && !offer.closedAt ? `<p><a href="${escapeHtml(original)}" rel="nofollow noopener">Voir l'offre d'origine et postuler</a>${sourceName ? ` · Source : ${escapeHtml(sourceName)}` : ""}</p>` : ""}
</article>`;
}

const replaceTag = (html: string, pattern: RegExp, replacement: string) => (pattern.test(html) ? html.replace(pattern, () => replacement) : html);

// The app's page with the offer: title, meta tags, canonical, JobPosting, content.
export function offerPageHtml(page: string, offer: PublicOffer): string {
  const canonical = `${config.webBaseUrl}/offers/${offer.id}`;
  const company = offer.company?.name ?? offer.companyName;
  const place = placeText(offer);
  const title = [offer.title, company, place].filter(Boolean).join(" – ");
  const facts = [CONTRACTS[offer.contractType ?? ""], place].filter(Boolean).join(", ");
  const description = plainText(offer.description, 160 - facts.length - 2).replace(/^/, facts ? `${facts}. ` : "");
  const posting = jobPosting(offer, canonical);
  const head = [
    `<link rel="canonical" href="${escapeHtml(canonical)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${escapeHtml(config.seo.siteName)}" />`,
    `<meta property="og:title" content="${escapeHtml(title)}" />`,
    `<meta property="og:description" content="${escapeHtml(description)}" />`,
    `<meta property="og:url" content="${escapeHtml(canonical)}" />`,
    offer.closedAt ? `<meta name="robots" content="noindex" />` : "",
    // Data for search engines, not a script (the CSP forbids inline scripts, not data).
    posting ? `<script type="application/ld+json">${JSON.stringify(posting).replace(/</g, "\\u003c")}</script>` : "",
  ].filter(Boolean).join("\n    ");
  let html = replaceTag(page, /<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(`${title} | ${config.seo.siteName}`)}</title>`);
  html = replaceTag(html, /<meta name="description" content="[^"]*"\s*\/?>/, `<meta name="description" content="${escapeHtml(description)}" />`);
  html = html.replace("</head>", () => `    ${head}\n  </head>`);
  return html.replace(/<div id="root"><\/div>/, () => `<div id="root">${offerArticle(offer)}</div>`);
}

// The app's page for an address that doesn't exist (any more): status 404, not indexed.
export function notFoundPageHtml(page: string): string {
  return page.replace("</head>", () => `    <meta name="robots" content="noindex" />\n  </head>`);
}
