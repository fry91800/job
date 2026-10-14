import { parse } from "node-html-parser";
import type { CollectedOffer } from "@job/shared";
import { collectorConfig } from "../../config";
import { firstPathSegment, type AtsAdapter } from "../adapter";
import { fetchJson } from "../http";
import { contractFrom, frenchCity, isoDate, mentionsFrance, remoteFrom } from "../mapping";

type Job = {
  id: number;
  title: string;
  absolute_url: string;
  updated_at?: string;
  first_published?: string;
  language?: string;
  location?: { name?: string };
  offices?: { name?: string; location?: string | null }[];
  metadata?: { name: string; value: unknown }[] | null;
  content?: string;
};

const base = () => collectorConfig.ats.baseUrls.greenhouse;
const inFrance = (job: Job) => mentionsFrance(job.location?.name) || (job.offices ?? []).some((office) => mentionsFrance(office.name) || mentionsFrance(office.location));
const jobsOf = (slug: string) => fetchJson<{ jobs: Job[] }>(`${base()}/v1/boards/${encodeURIComponent(slug)}/jobs?content=true`);

// Greenhouse sends the description as HTML written with entities ("&lt;h2&gt;").
const decodeEntities = (html: string) => parse(`<div>${html}</div>`).text;

export function greenhouseOffer(job: Job, slug: string, companyName: string): CollectedOffer {
  const location = job.location?.name ?? null;
  const metadata = (job.metadata ?? []).map((item) => (typeof item.value === "string" ? item.value : "")).join(" ");
  return {
    contractVersion: 1,
    source: "greenhouse",
    externalId: `${slug}:${job.id}`,
    url: job.absolute_url,
    title: job.title,
    company: { name: companyName, atsSlug: slug },
    location: { raw: location, city: frenchCity(location), countryCode: "FR" },
    remote: remoteFrom(location, job.title),
    contractType: contractFrom(job.title, metadata),
    description: { format: "html", content: decodeEntities(job.content ?? "") || job.title },
    language: job.language === "fr" || job.language === "en" ? job.language : null,
    publishedAt: isoDate(job.first_published ?? job.updated_at),
    collectedAt: new Date().toISOString(),
  };
}

export const greenhouse: AtsAdapter = {
  ats: "greenhouse",
  discovery: {
    prefixes: ["boards.greenhouse.io/", "job-boards.greenhouse.io/", "job-boards.eu.greenhouse.io/"],
    // boards.greenhouse.io/{slug}/jobs/1 or boards.greenhouse.io/embed/job_board?for={slug}
    slugFromUrl: (url) => url.searchParams.get("for") ?? firstPathSegment(url),
  },
  async check(slug) {
    const [board, { jobs }] = await Promise.all([fetchJson<{ name?: string }>(`${base()}/v1/boards/${encodeURIComponent(slug)}`), jobsOf(slug)]);
    return { companyName: board.name?.trim() || null, jobCount: jobs.length, franceJobCount: jobs.filter(inFrance).length };
  },
  async *collect(slug, companyName) {
    const { jobs } = await jobsOf(slug);
    for (const job of jobs.filter(inFrance)) yield { raw: job, offer: greenhouseOffer(job, slug, companyName) };
  },
};
