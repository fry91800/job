import type { CollectedOffer } from "@job/shared";
import { collectorConfig } from "../../config";
import { firstPathSegment, refreshDue, type AtsAdapter } from "../adapter";
import { fetchJson, NotFoundError, pause } from "../http";
import { contractFrom, isoDate } from "../mapping";

type Posting = {
  id: string;
  name: string;
  releasedDate?: string;
  company?: { name?: string; identifier?: string };
  location?: { city?: string; region?: string; country?: string; remote?: boolean; hybrid?: boolean; latitude?: string; longitude?: string; fullLocation?: string };
  typeOfEmployment?: { label?: string };
  customField?: { fieldLabel?: string; valueLabel?: string }[];
};
type Detail = Posting & {
  postingUrl?: string;
  applyUrl?: string;
  jobAd?: { sections?: Record<string, { title?: string; text?: string }> };
};

const base = () => collectorConfig.ats.baseUrls.smartrecruiters;
const PAGE = 100;
const SECTIONS = ["companyDescription", "jobDescription", "qualifications", "additionalInformation"];

// Board ids are case-sensitive ("Ubisoft2").
async function page(slug: string, offset: number, country?: string) {
  const query = new URLSearchParams({ limit: String(PAGE), offset: String(offset), ...(country && { country }) });
  return fetchJson<{ totalFound: number; content: Posting[] }>(`${base()}/v1/companies/${encodeURIComponent(slug)}/postings?${query}`);
}

export function smartRecruitersOffer(detail: Detail, slug: string, companyName: string): CollectedOffer {
  const sections = detail.jobAd?.sections ?? {};
  const html = SECTIONS.map((key) => sections[key])
    .filter((section) => section?.text)
    .map((section) => `${section!.title ? `<h2>${section!.title}</h2>` : ""}${section!.text}`)
    .join("\n");
  const location = detail.location ?? {};
  const contractField = (detail.customField ?? []).find((field) => /contra/i.test(field.fieldLabel ?? ""))?.valueLabel;
  const coordinate = (value?: string) => (value && !Number.isNaN(Number(value)) ? Number(value) : null);
  return {
    contractVersion: 1,
    source: "smartrecruiters",
    externalId: `${slug}:${detail.id}`,
    url: detail.postingUrl ?? `https://jobs.smartrecruiters.com/${slug}/${detail.id}`,
    applyUrl: detail.applyUrl ?? null,
    title: detail.name,
    company: { name: detail.company?.name || companyName, atsSlug: slug },
    location: { raw: location.fullLocation ?? null, city: location.city ?? null, countryCode: "FR", latitude: coordinate(location.latitude), longitude: coordinate(location.longitude) },
    remote: location.remote ? "remote" : location.hybrid ? "hybrid" : null,
    contractType: contractFrom(detail.name, detail.typeOfEmployment?.label, contractField),
    description: { format: "html", content: html || detail.name },
    publishedAt: isoDate(detail.releasedDate),
    collectedAt: new Date().toISOString(),
  };
}

export const smartRecruiters: AtsAdapter = {
  ats: "smartrecruiters",
  discovery: { prefixes: ["jobs.smartrecruiters.com/", "careers.smartrecruiters.com/"], slugFromUrl: firstPathSegment },
  async check(slug) {
    const [all, france] = await Promise.all([page(slug, 0), page(slug, 0, "fr")]);
    return { companyName: all.content[0]?.company?.name ?? null, jobCount: all.totalFound, franceJobCount: france.totalFound };
  },
  // The list API filters on France; the description needs one detail request per offer,
  // so known offers with the same release date are only reported as still listed.
  async *collect(slug, companyName, known) {
    for (let offset = 0; ; offset += PAGE) {
      const { totalFound, content } = await page(slug, offset, "fr");
      for (const posting of content) {
        const externalId = `${slug}:${posting.id}`;
        if (known?.has(externalId) && known.get(externalId) === (posting.releasedDate ?? null) && !refreshDue(externalId)) {
          yield { stillListed: externalId };
          continue;
        }
        await pause(collectorConfig.ats.pauseBetweenRequestsMs);
        let detail: Detail;
        try {
          detail = await fetchJson<Detail>(`${base()}/v1/companies/${encodeURIComponent(slug)}/postings/${posting.id}`);
        } catch (error) {
          // The offer was removed between the list and its detail: skip it. Only the board's
          // list can say that the board itself is gone.
          if (error instanceof NotFoundError) continue;
          throw error;
        }
        yield { raw: detail, offer: smartRecruitersOffer(detail, slug, companyName) };
      }
      if (offset + PAGE >= totalFound || content.length === 0) break;
    }
  },
};
