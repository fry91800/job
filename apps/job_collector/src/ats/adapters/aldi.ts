import type { CollectedOffer, ContractType } from "@job/shared";
import { collectorConfig } from "../../config";
import type { CollectedRecord } from "../../connectors/types";
import { CrawlError, crawlGet, PageGoneError } from "../../crawler/fetcher";
import { refreshDue, type AtsAdapter, type PartialListing, type StillListed } from "../adapter";
import { NotFoundError } from "../http";
import { contractFrom, isoDate } from "../mapping";

// Aldi France (www.aldi.fr, COLLECTOR.md §17.16): its offers come from TalentLink (Lumesse)
// but are shown by its own site, built with Next.js. Checked 2026-10-19:
// * robots.txt allows /carriere/;
// * /carriere/recherche-offres.html carries every offer in the page's data
//   (__NEXT_DATA__ → apiData → JOB_HR_GET_ALL: 590 offers, postingId, title, onlineFrom /
//   onlineUntil, careerLevelName "Contrat à durée indéterminée", jobTypeName "À mi-temps",
//   locations with zipCode and city, applicationUrl, slugTitle);
// * offer pages /carriere/detail/{slugTitle}-{postingId}.html carry the offer's texts in the
//   same way (JOB_HR_GET: jobDuties, jobRequirements, freeText, aboutUs with their labels).
// The list is complete: offers missing from it are closed. A new offer's page is read once
// for its description, within the page budget per run.

const SOURCE = "aldi";
const SEARCH_PATH = "/carriere/recherche-offres.html";

type AldiLocation = { zipCode?: string | null; city?: string | null; region?: string | null; country?: string | null };
type AldiJob = {
  postingId?: string;
  title?: string;
  onlineFrom?: string;
  onlineUntil?: string;
  careerLevelName?: string;
  jobTypeName?: string;
  jobCategoryName?: string;
  applicationUrl?: string;
  slugTitle?: string;
  locations?: AldiLocation[];
  jobDutiesLabel?: string;
  jobDuties?: string;
  jobRequirementsLabel?: string;
  jobRequirements?: string;
  freeTextLabel?: string;
  freeText?: string;
  aboutUsLabel?: string;
  aboutUs?: string;
};

// The page's API answers, by request name ("JOB_HR_GET_ALL" → its response).
export function nextApiData(html: string): Map<string, unknown> {
  const match = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  const answers = new Map<string, unknown>();
  if (!match) return answers;
  try {
    let data = (JSON.parse(match[1]) as { props?: { pageProps?: { apiData?: unknown } } }).props?.pageProps?.apiData;
    if (typeof data === "string") data = JSON.parse(data);
    for (const entry of Array.isArray(data) ? data : []) {
      if (Array.isArray(entry) && typeof entry[0] === "string") answers.set(entry[0], (entry[1] as { res?: unknown } | undefined)?.res);
    }
  } catch {
    // Not the expected page.
  }
  return answers;
}

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// The offer's texts as HTML: each part under its label, line breaks kept.
export function aldiDescription(job: AldiJob): string {
  const parts: [string | undefined, string | undefined][] = [
    [job.jobDutiesLabel, job.jobDuties],
    [job.jobRequirementsLabel, job.jobRequirements],
    [job.freeTextLabel, job.freeText],
    [job.aboutUsLabel, job.aboutUs],
  ];
  return parts
    .filter(([, text]) => text?.trim())
    .map(([label, text]) => `${label ? `<h3>${escape(label)}</h3>` : ""}<p>${escape(text!.trim()).replace(/\n{2,}/g, "</p><p>").replace(/\n/g, "<br>")}</p>`)
    .join("");
}

const CONTRACTS: [RegExp, ContractType][] = [
  [/ind[ée]termin/i, "permanent"],
  [/d[ée]termin/i, "fixed_term"],
];

export function aldiOffer(slug: string, companyName: string, job: AldiJob, page: { url: string; description: string | null }): CollectedOffer {
  const place = job.locations?.[0] ?? {};
  const contract = job.careerLevelName ?? "";
  return {
    contractVersion: 1,
    source: SOURCE,
    externalId: `${slug}:${job.postingId}`,
    url: page.url,
    applyUrl: job.applicationUrl && /^https?:\/\//.test(job.applicationUrl) ? job.applicationUrl : null,
    title: job.title!,
    company: { name: companyName, atsSlug: slug },
    location: { raw: [place.city, place.zipCode].filter(Boolean).join(" ") || null, city: place.city ?? null, postcode: place.zipCode ?? null, countryCode: "FR" },
    contractType: CONTRACTS.find(([pattern]) => pattern.test(contract))?.[1] ?? contractFrom(contract, job.title),
    description: { format: "html", content: page.description || job.title! },
    publishedAt: isoDate(job.onlineFrom),
    expiresAt: isoDate(job.onlineUntil),
    collectedAt: new Date().toISOString(),
  };
}

async function allJobs(slug: string): Promise<AldiJob[]> {
  let html: string;
  try {
    html = (await crawlGet(`${collectorConfig.crawler.scheme}://${slug}${SEARCH_PATH}`)).text;
  } catch (error) {
    if (error instanceof PageGoneError) throw new NotFoundError(error.message);
    throw error;
  }
  const all = nextApiData(html).get("JOB_HR_GET_ALL") as { results?: AldiJob[] } | undefined;
  if (!all?.results) throw new NotFoundError(`${slug}: no job list in the search page`);
  return all.results.filter((job) => job.postingId && job.title && (job.locations?.[0]?.country ?? "France").toLowerCase() === "france");
}

const pageUrl = (slug: string, job: AldiJob) => `${collectorConfig.crawler.scheme}://${slug}/carriere/detail/${job.slugTitle ? `${job.slugTitle}-` : ""}${job.postingId}.html`;

export const aldi: AtsAdapter = {
  ats: SOURCE,
  kind: "crawler",
  schedule: "0 6 * * *", // daily, like the career sites

  async check(slug) {
    const jobs = await allJobs(slug);
    return { companyName: "Aldi", jobCount: jobs.length, franceJobCount: jobs.length };
  },

  async *collect(slug, companyName, known): AsyncGenerator<CollectedRecord | StillListed | PartialListing> {
    const jobs = await allJobs(slug);
    let pagesRead = 0;
    let failures = 0;
    let waiting = false;
    for (const job of jobs) {
      const externalId = `${slug}:${job.postingId}`;
      const version = `${job.onlineFrom ?? ""}|${job.onlineUntil ?? ""}`;
      if (known?.has(externalId) && known.get(externalId) === version && !refreshDue(externalId)) {
        yield { stillListed: externalId };
        continue;
      }
      if (pagesRead >= collectorConfig.crawler.maxOfferPagesPerRun) {
        if (known?.has(externalId)) yield { stillListed: externalId };
        else waiting = true;
        continue;
      }
      pagesRead++;
      const url = pageUrl(slug, job);
      let detail: AldiJob | undefined;
      try {
        detail = nextApiData((await crawlGet(url)).text).get("JOB_HR_GET") as AldiJob | undefined;
        failures = 0;
      } catch (error) {
        if (!(error instanceof CrawlError)) throw error;
        if (error instanceof PageGoneError) continue;
        if (++failures >= 5) throw error;
        if (known?.has(externalId)) yield { stillListed: externalId };
        continue;
      }
      const merged = { ...job, ...detail };
      yield { raw: { url, releasedDate: version, job: merged }, offer: aldiOffer(slug, companyName, merged, { url, description: aldiDescription(merged) || null }) };
    }
    if (waiting) yield { partialListing: true };
  },
};
