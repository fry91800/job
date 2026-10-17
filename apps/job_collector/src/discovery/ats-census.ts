// `npm run collector -- census [--crawls N]`: how many companies use each recruiting tool
// in Common Crawl, and how many of them have French-language pages (COLLECTOR.md §17,
// step 1), to choose which tools to support next. Reads the index files only.
import { capturesFor, surtPrefixes } from "./cc-index";
import { recentCrawls } from "./common-crawl";

// Tool → where its public job pages live, and how a company shows in the address:
// "host" ({company}.tool.com) or the n-th path segment (tool.com/{company}/…).
type CensusTool = { name: string; prefix: string; matchType: "prefix" | "domain"; company: "host" | number; supported?: boolean };

export const CENSUS_TOOLS: CensusTool[] = [
  { name: "smartrecruiters", prefix: "jobs.smartrecruiters.com/", matchType: "prefix", company: 1, supported: true },
  { name: "greenhouse", prefix: "boards.greenhouse.io/", matchType: "prefix", company: 1, supported: true },
  { name: "greenhouse (new)", prefix: "job-boards.greenhouse.io/", matchType: "prefix", company: 1, supported: true },
  { name: "ashby", prefix: "jobs.ashbyhq.com/", matchType: "prefix", company: 1, supported: true },
  { name: "lever", prefix: "jobs.lever.co/", matchType: "prefix", company: 1, supported: true },
  { name: "lever eu", prefix: "jobs.eu.lever.co/", matchType: "prefix", company: 1, supported: true },
  { name: "workable", prefix: "apply.workable.com/", matchType: "prefix", company: 1, supported: true },
  { name: "recruitee", prefix: "recruitee.com", matchType: "domain", company: "host", supported: true },
  { name: "teamtailor (career sites)", prefix: "teamtailor.com", matchType: "domain", company: "host", supported: true },
  { name: "personio (.de)", prefix: "jobs.personio.de", matchType: "domain", company: "host" },
  { name: "personio (.com)", prefix: "jobs.personio.com", matchType: "domain", company: "host" },
  { name: "welcome to the jungle", prefix: "www.welcometothejungle.com/fr/companies/", matchType: "prefix", company: 3 },
  { name: "welcome kit", prefix: "welcomekit.co", matchType: "domain", company: "host" },
  { name: "digitalrecruiters", prefix: "digitalrecruiters.com", matchType: "domain", company: "host" },
  { name: "flatchr", prefix: "flatchr.io", matchType: "domain", company: "host" },
  { name: "taleez", prefix: "taleez.com/careers/", matchType: "prefix", company: 2 },
  { name: "jobaffinity", prefix: "jobaffinity.fr", matchType: "domain", company: "host" },
  { name: "talentsoft", prefix: "talent-soft.com", matchType: "domain", company: "host", supported: true },
  { name: "workday", prefix: "myworkdayjobs.com", matchType: "domain", company: "host", supported: true },
  { name: "successfactors", prefix: "successfactors.eu", matchType: "domain", company: "host" },
  { name: "breezy", prefix: "breezy.hr", matchType: "domain", company: "host" },
  { name: "bamboohr", prefix: "bamboohr.com", matchType: "domain", company: "host" },
  { name: "jobvite", prefix: "jobs.jobvite.com/", matchType: "prefix", company: 1 },
  { name: "join", prefix: "join.com/companies/", matchType: "prefix", company: 2 },
  { name: "werecruit", prefix: "werecruit.io", matchType: "domain", company: "host" },
  { name: "zoho recruit", prefix: "zohorecruit.eu", matchType: "domain", company: "host" },
  { name: "pinpoint", prefix: "pinpointhq.com", matchType: "domain", company: "host" },
  { name: "icims", prefix: "icims.com", matchType: "domain", company: "host" },
  { name: "taleo", prefix: "taleo.net", matchType: "domain", company: "host" },
  { name: "beetween", prefix: "beetween.com", matchType: "domain", company: "host" },
];

const companyOf = (url: string, company: "host" | number): string | null => {
  try {
    const parsed = new URL(url);
    if (company === "host") return parsed.hostname.toLowerCase().replace(/^www\./, "");
    const segment = parsed.pathname.split("/").filter(Boolean)[company - 1];
    return segment && !segment.includes(".") ? segment.toLowerCase() : null;
  } catch {
    return null;
  }
};

export async function atsCensus(options: { crawls?: number; log?: (message: string) => void } = {}) {
  const log = options.log ?? ((message: string) => console.log(`[census] ${message}`));
  const crawls = await recentCrawls(options.crawls ?? 1);
  const rows: { tool: string; supported: string; companies: number; "with French pages": number }[] = [];
  for (const tool of CENSUS_TOOLS) {
    const companies = new Set<string>();
    const french = new Set<string>();
    for (const crawl of crawls) {
      try {
        for (const capture of await capturesFor(crawl, surtPrefixes(tool.prefix, tool.matchType))) {
          const company = companyOf(capture.url, tool.company);
          if (!company) continue;
          companies.add(company);
          if ((capture.languages ?? "").split(",").includes("fra")) french.add(company);
        }
      } catch (error) {
        log(`${tool.name} ${crawl}: ${error instanceof Error ? error.message : error}`);
      }
    }
    rows.push({ tool: tool.name, supported: tool.supported ? "yes" : "", companies: companies.size, "with French pages": french.size });
    log(`${tool.name}: ${companies.size} companies, ${french.size} with French pages`);
  }
  rows.sort((a, b) => b["with French pages"] - a["with French pages"]);
  console.table(rows);
  return rows;
}
