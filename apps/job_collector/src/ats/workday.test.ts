import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import { backendConfig, prisma } from "@job/backend";
import { collectorConfig } from "../config";
import { resetCrawler } from "../crawler/fetcher";
import { runConnector } from "../runs/run-connector";
import { franceFilter, resetWorkdayMemory, splitFilter, workday, workdaySlugFromUrl } from "./adapters/workday";
import { atsConnector } from "./connector";

// A local Workday career site: robots.txt, the JSON job list (POST, with a country filter
// that honours the France value) and job pages with JobPosting markup. Its board is
// "127.0.0.1:<port>/TestSite" in the test database.

const LONG = "Vous rejoindrez l'équipe data et développerez les pipelines de traitement en Python. ".repeat(3);
const FRANCE = "54c5b6971ffb4bf0b116fe7651ec789a";
type Job = { id: string; title: string; country: "FR" | "US"; city: string; date: string; pageCity?: string };
let jobs: Job[] = [];
let requests: { method: string; path: string; body?: string }[] = [];
let server: http.Server;
let slug: string;
const TEST_BOARD = () => ({ ats: "workday", slug });

const jobPath = (job: Job) => `/job/${job.city}/${job.title.replace(/\W+/g, "-")}_${job.id}`;
const jobPage = (job: Job) =>
  `<html><head><script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: job.title,
    description: `<p>${LONG}</p>`,
    datePosted: job.date,
    employmentType: "FULL_TIME",
    hiringOrganization: { "@type": "Organization", name: "(0122) Test Industrie" },
    jobLocation: { "@type": "Place", address: { "@type": "PostalAddress", addressLocality: job.pageCity ?? job.city, addressCountry: job.pageCity ? "United States" : job.country === "FR" ? "France" : "United States" } },
  })}</script></head><body></body></html>`;

function route(method: string, path: string, body: string): [number, string, string] {
  if (path === "/robots.txt") return [200, "text/plain", "User-agent: *\nAllow: /TestSite/\nDisallow: /refreshFacet/\n"];
  if (method === "POST" && /^\/wday\/cxs\/[^/]+\/TestSite\/jobs$/.test(path)) {
    const request = JSON.parse(body) as { appliedFacets: Record<string, string[]>; offset: number; limit: number };
    const filtered = request.appliedFacets.locationCountry?.includes(FRANCE) ? jobs.filter((job) => job.country === "FR") : jobs;
    // Like Workday: past the end, offsets answer the last jobs again.
    const page = filtered.slice(Math.min(request.offset, Math.max(0, filtered.length - request.limit)), Math.min(request.offset, Math.max(0, filtered.length - request.limit)) + request.limit);
    return [200, "application/json", JSON.stringify({
      // Like Workday: the total on the first page only, capped at 2 000.
      total: request.offset === 0 ? Math.min(filtered.length, 2000) : 0,
      jobPostings: page.map((job) => ({ title: job.title, externalPath: jobPath(job), locationsText: job.city, startDate: job.date, bulletFields: [job.id] })),
      facets: [{ facetParameter: "locationMainGroup", values: [{ facetParameter: "locationCountry", descriptor: "Country", values: [
        { descriptor: "France", id: FRANCE, count: jobs.filter((job) => job.country === "FR").length },
        { descriptor: "United States of America", id: "us-id", count: jobs.filter((job) => job.country === "US").length },
      ] }] }],
    })];
  }
  const job = jobs.find((item) => path === `/TestSite${jobPath(item)}`);
  if (job) return [200, "text/html; charset=utf-8", jobPage(job)];
  return [404, "text/html", "not found"];
}

before(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const path = new URL(req.url!, "http://localhost").pathname;
      requests.push({ method: req.method!, path, body });
      const [status, type, text] = route(req.method!, path, body);
      res.writeHead(status, { "Content-Type": type }).end(text);
    });
  });
  server.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  slug = `127.0.0.1:${(server.address() as AddressInfo).port}/TestSite`;
  Object.assign(collectorConfig.crawler, { scheme: "http", minDelayMs: 0, allowedPrivateAddresses: ["127.0.0.1"] });
  collectorConfig.ats.pauseBetweenBoardsMs = 0;
  collectorConfig.ats.detailRefreshDays = 1_000_000_000; // no weekly refresh during the tests
  backendConfig.geoapify.apiKey = undefined;
});

after(async () => {
  server.close();
  const sources = await prisma.offerSource.findMany({ where: { source: "workday", externalId: { startsWith: slug } }, select: { offerId: true } });
  await prisma.offer.deleteMany({ where: { id: { in: sources.map((row) => row.offerId) } } });
  await prisma.rawOffer.deleteMany({ where: { source: "workday", externalId: { startsWith: slug } } });
  const board = await prisma.companySource.findUnique({ where: { ats_slug: TEST_BOARD() } });
  await prisma.companySource.deleteMany({ where: TEST_BOARD() });
  if (board?.companyId) await prisma.company.deleteMany({ where: { id: board.companyId } });
  await prisma.collectorRun.deleteMany({ where: { connector: "test-workday" } });
  await prisma.$disconnect();
});

describe("Workday addresses and filters", () => {
  test("board ids: host and career site, language prefix skipped", () => {
    assert.equal(workdaySlugFromUrl(new URL("https://sanofi.wd3.myworkdayjobs.com/en-US/SanofiCareers/job/Lyon/Engineer_R2847743")), "sanofi.wd3.myworkdayjobs.com/SanofiCareers");
    assert.equal(workdaySlugFromUrl(new URL("https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite")), "nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite");
    for (const url of ["https://sanofi.wd3.myworkdayjobs.com/", "https://sanofi.wd3.myworkdayjobs.com/wday/cxs/x", "https://www.myworkdayjobs.com/SanofiCareers"]) assert.equal(workdaySlugFromUrl(new URL(url)), null, url);
  });

  test("a second filter splitting a list over the 2 000 cap: values under it, fewest first", () => {
    const facets = [
      { facetParameter: "jobFamilyGroup", values: [{ id: "a", count: 3337 }, { id: "b", count: 14 }] },
      { facetParameter: "Job_Profiles", values: Array.from({ length: 35 }, (_, index) => ({ id: `p${index}`, count: index === 0 ? 1865 : 44 })) },
      { facetParameter: "locationMainGroup", values: [{ facetParameter: "locations", values: [{ id: "lyon", count: 165 }] }] },
      { facetParameter: "workerSubType", values: Array.from({ length: 40 }, (_, index) => ({ id: `w${index}`, count: 100 })) },
    ];
    assert.deepEqual(splitFilter(facets, 3351, "locationCountry")?.parameter, "Job_Profiles", "under the cap, covering the list, fewest values");
    assert.equal(splitFilter(facets.slice(0, 1), 3351, "locationCountry"), null);
  });

  test("the France value of the country filter, nested or not", () => {
    assert.deepEqual(franceFilter([{ facetParameter: "locationMainGroup", values: [{ facetParameter: "locationCountry", values: [{ descriptor: "France", id: "fr", count: 150 }] }] }]), { parameter: "locationCountry", id: "fr", count: 150 });
    assert.equal(franceFilter([{ facetParameter: "locations", values: [{ descriptor: "Paris", id: "p" }] }]), null);
  });
});

describe("Workday runs", () => {
  test("France only, from the job list; unchanged jobs not fetched again; jobs gone are closed", async () => {
    resetCrawler();
    resetWorkdayMemory();
    jobs = [
      { id: "R1001", title: "Data Engineer", country: "FR", city: "Lyon", date: "2026-10-15" },
      { id: "R1002", title: "Responsable paie", country: "FR", city: "Gentilly", date: "2026-10-14" },
      { id: "R1003", title: "Chef de projet", country: "FR", city: "Paris", date: "2026-10-13", pageCity: "Boston" }, // several places, the page names Boston first
      { id: "R2001", title: "Sales Manager", country: "US", city: "Boston", date: "2026-10-15" },
    ];
    await prisma.companySource.create({ data: { ...TEST_BOARD(), status: "candidate" } });
    const check = await workday.check(slug);
    assert.deepEqual([check.jobCount, check.franceJobCount], [4, 3], "the France count comes from the filter");
    await prisma.companySource.update({ where: { ats_slug: TEST_BOARD() }, data: { status: "active", company: { create: { name: "Test Workday", normalizedName: "test workday" } } } });

    const connector = atsConnector(workday, { where: TEST_BOARD(), key: "test-workday" });
    requests = [];
    const first = await runConnector(connector, { log: () => {} });
    assert.equal(first.counts.created, 3);
    assert.ok(!requests.some((request) => request.path.includes("Sales-Manager")), "jobs abroad are never fetched");
    assert.ok(requests.some((request) => request.method === "POST" && request.body?.includes(FRANCE)), "the list is filtered on France");
    const boston = await prisma.offerSource.findUniqueOrThrow({ where: { source_externalId: { source: "workday", externalId: `${slug}:R1003` } }, include: { offer: { include: { company: true } } } });
    assert.equal(boston.offer.company?.name, "Test Workday", "the board's company, not the legal entity on the page");

    requests = [];
    const second = await runConnector(connector, { log: () => {} });
    assert.equal(second.counts.received, 0);
    assert.ok(!requests.some((request) => request.path.includes("/job/")), "unchanged jobs are not fetched again");

    jobs = jobs.filter((job) => job.id !== "R1002");
    await runConnector(connector, { log: () => {} });
    const closed = await prisma.offerSource.findUniqueOrThrow({ where: { source_externalId: { source: "workday", externalId: `${slug}:R1002` } } });
    assert.ok(closed.closedAt);
  });

  test("every page of the list, though Workday only gives the total on the first", async () => {
    resetCrawler();
    jobs = Array.from({ length: 45 }, (_, index) => ({ id: `R${3000 + index}`, title: `Technicien ${index}`, country: "FR", city: "Lyon", date: "2026-10-15" }));
    const known = new Map(jobs.map((job) => [`${slug}:${job.id}`, job.date]));
    let listed = 0;
    for await (const item of workday.collect(slug, "Test Workday", known)) if ("stillListed" in item) listed++;
    assert.equal(listed, 45);
  });
});
