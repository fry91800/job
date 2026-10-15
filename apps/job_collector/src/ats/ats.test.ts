import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import { backendConfig, prisma } from "@job/backend";
import { collectorConfig } from "../config";
import { checkBoards } from "../discovery/check-boards";
import { discoverBoards, slugsFromIndexLines } from "../discovery/common-crawl";
import { runConnector } from "../runs/run-connector";
import type { CollectedRecord } from "../connectors/types";
import type { KnownOffers } from "./adapter";
import { atsConnector } from "./connector";
import { contractFrom, frenchCity, mentionsFrance, nameFromSlug, remoteFrom, salaryPeriod } from "./mapping";
import { findAdapter } from "./registry";

// A local server answering like each recruiting tool (formats copied from real answers)
// and like Common Crawl's index. Board slugs start with "test-", and every check or run
// is limited to them: real boards in the database are never touched.

const TEST_BOARDS = { slug: { startsWith: "test-" } };

const LONG = "Vous rejoindrez une équipe produit de dix personnes et participerez à la conception de nouvelles fonctionnalités. ".repeat(3);
let greenhouseJobs: object[] = [];
let failing = false;

const greenhouseJob = (id: number, location: string, fields: object = {}) => ({
  id,
  title: `Développeur React ${id}`,
  absolute_url: `https://careers.test-acme.example/jobs/${id}`,
  first_published: "2026-10-01T10:00:00-04:00",
  language: "fr",
  location: { name: location },
  offices: [],
  metadata: [{ name: "Time Type", value: "Full time" }],
  content: `&lt;h2&gt;&lt;strong&gt;Le poste&lt;/strong&gt;&lt;/h2&gt;&lt;p&gt;${LONG} React, Node.js et PostgreSQL.&lt;/p&gt;`,
  ...fields,
});

function route(url: URL): [number, unknown] {
  const path = url.pathname;
  // Greenhouse
  if (path === "/v1/boards/test-acme") return [200, { name: "Test Acme" }];
  if (path === "/v1/boards/test-acme/jobs") return failing ? [500, {}] : [200, { jobs: greenhouseJobs, meta: { total: greenhouseJobs.length } }];
  if (path === "/v1/boards/test-abroad") return [200, { name: "Test Abroad" }];
  if (path === "/v1/boards/test-abroad/jobs") return [200, { jobs: [greenhouseJob(9, "London, UK")] }];
  if (path === "/v1/boards/test-empty") return [200, { name: "Test Empty" }];
  if (path === "/v1/boards/test-empty/jobs") return [200, { jobs: [] }];
  // Ashby
  if (path === "/posting-api/job-board/test-acme") {
    return [200, { apiVersion: "1", jobs: [
      { id: "a1", title: "Product Designer", employmentType: "FullTime", location: "Paris", publishedAt: "2026-10-02T09:00:00Z", isListed: true, workplaceType: "Hybrid", address: { postalAddress: { addressLocality: "Paris", addressCountry: "France" } }, jobUrl: "https://jobs.ashbyhq.com/test-acme/a1", applyUrl: "https://jobs.ashbyhq.com/test-acme/a1/application", descriptionHtml: `<p>${LONG}</p>`, compensation: { summaryComponents: [{ compensationType: "Salary", interval: "1 YEAR", currencyCode: "EUR", minValue: 50000, maxValue: 60000 }] } },
      { id: "a2", title: "Sales Belgium", employmentType: "FullTime", location: "Brussels", isListed: true, address: { postalAddress: { addressCountry: "Belgium" } }, jobUrl: "https://jobs.ashbyhq.com/test-acme/a2", descriptionHtml: "<p>x</p>" },
      { id: "a3", title: "Stage Data", employmentType: "Intern", location: "Remote EMEA", secondaryLocations: [{ location: "Lyon, France" }], isListed: true, jobUrl: "https://jobs.ashbyhq.com/test-acme/a3", descriptionHtml: `<p>${LONG}</p>` },
      { id: "a4", title: "Hidden", location: "Paris", isListed: false, jobUrl: "https://jobs.ashbyhq.com/test-acme/a4", descriptionHtml: "<p>x</p>" },
    ] }];
  }
  // Lever
  if (path === "/v0/postings/test-acme") {
    return [200, [
      { id: "l1", text: "Backend Engineer", hostedUrl: "https://jobs.lever.co/test-acme/l1", applyUrl: "https://jobs.lever.co/test-acme/l1/apply", createdAt: 1790000000000, country: "FR", workplaceType: "remote", categories: { commitment: "CDI", location: "Nantes" }, description: `<p>${LONG}</p>`, lists: [{ text: "Profil", content: "<li>Node.js</li><li>PostgreSQL</li>" }], salaryRange: { min: 55000, max: 65000, currency: "EUR", interval: "per-year-salary" } },
      { id: "l2", text: "US only", hostedUrl: "https://jobs.lever.co/test-acme/l2", country: "US", categories: { location: "Atlanta" }, description: "<p>x</p>" },
    ]];
  }
  // SmartRecruiters
  const sr = /^\/v1\/companies\/TestAcme\/postings(?:\/(\w+))?$/.exec(path);
  if (sr && sr[1] === "s2gone") return [404, { message: "not found" }];
  if (sr && sr[1]) {
    return [200, {
      id: sr[1], name: `Alternance Développeur ${sr[1]}`, releasedDate: "2026-10-03T08:00:00Z", company: { name: "Test Acme SR", identifier: "TestAcme" },
      location: { city: "Toulouse", country: "fr", remote: false, hybrid: true, latitude: "43.60", longitude: "1.44", fullLocation: "Toulouse, France" },
      typeOfEmployment: { label: "Full-time" }, postingUrl: `https://jobs.smartrecruiters.com/TestAcme/${sr[1]}`,
      jobAd: { sections: { companyDescription: { title: "L'entreprise", text: "<p>Test Acme</p>" }, jobDescription: { title: "Le poste", text: `<p>${LONG}</p>` } } },
    }];
  }
  if (sr) {
    const france = url.searchParams.get("country") === "fr";
    const ids = france ? ["s1", "s2", "s2gone"] : ["s1", "s2", "s3"];
    return [200, { totalFound: ids.length, content: ids.map((id) => ({ id, name: id, company: { name: "Test Acme SR" } })) }];
  }
  // Workable
  if (path === "/api/v1/widget/accounts/test-acme") {
    return [200, { name: "Test Acme W", jobs: [
      { title: "Stage Développeur Python", shortcode: "W1", employment_type: "Internship", telecommuting: false, url: "https://apply.workable.com/test-acme/j/W1/", application_url: "https://apply.workable.com/test-acme/j/W1/apply", published_on: "2026-10-05", country: "France", city: "Lille", state: "Hauts-de-France", locations: [{ country: "France", countryCode: "FR", city: "Lille", region: "Hauts-de-France" }], description: `<p>${LONG}</p>` },
      { title: "Account Executive", shortcode: "W2", country: "Germany", city: "Berlin", locations: [{ country: "Germany", countryCode: "DE", city: "Berlin" }], description: "<p>x</p>" },
    ] }];
  }
  // Recruitee (one host per company; the test base has no {slug})
  if (path === "/api/offers/") {
    return [200, { offers: [
      { id: 101, slug: "dev", title: "Développeur Go", careers_url: "https://test-acme.recruitee.com/o/dev", careers_apply_url: "https://test-acme.recruitee.com/o/dev/c/new", location: "Bordeaux, France", locations: [{ country_code: "FR", city: "Bordeaux", name: "Bordeaux, France", postal_code: "33000" }], hybrid: true, employment_type_code: "fulltime_permanent", description: `<p>${LONG}</p>`, requirements: "<p>Go, Kubernetes</p>", published_at: "2026-10-06 09:30:00 UTC", company_name: "Test Acme R", salary: { min: "48000", max: "58000", period: "year", currency: "EUR" } },
      { id: 102, slug: "us", title: "US Sales", locations: [{ country_code: "US", city: "Austin" }], country_code: "US", description: "<p>x</p>" },
    ] }];
  }
  // Common Crawl index
  if (path === "/collinfo.json") return [200, [{ id: "CC-TEST" }]];
  if (path === "/CC-TEST-index") {
    if (url.searchParams.get("showNumPages")) return [200, { pages: 2 }];
    const lines =
      url.searchParams.get("page") === "0"
        ? ['{"url":"https://jobs.ashbyhq.com/test-disc-one/123"}', '{"url":"https://jobs.ashbyhq.com/test-disc-two"}', "not json"]
        : ['{"url":"https://jobs.ashbyhq.com/test-disc-one/456"}', '{"url":"https://jobs.ashbyhq.com/robots.txt"}'];
    return [200, lines.join("\n")];
  }
  return [404, { error: "not found" }];
}

let server: http.Server;

before(async () => {
  server = http.createServer((req, res) => {
    const [status, body] = route(new URL(req.url!, "http://localhost"));
    res.writeHead(status, { "Content-Type": "application/json" }).end(typeof body === "string" ? body : JSON.stringify(body));
  });
  server.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  for (const ats of Object.keys(collectorConfig.ats.baseUrls)) collectorConfig.ats.baseUrls[ats] = base;
  collectorConfig.discovery.commonCrawlIndex = base;
  collectorConfig.ats.pauseBetweenBoardsMs = 0;
  collectorConfig.ats.pauseBetweenRequestsMs = 0;
  collectorConfig.discovery.pauseBetweenPagesMs = 0;
  backendConfig.geoapify.apiKey = undefined;
});

after(async () => {
  server.close();
  const sources = await prisma.offerSource.findMany({ where: { externalId: { startsWith: "test-" } }, select: { offerId: true } });
  await prisma.offer.deleteMany({ where: { id: { in: sources.map((row) => row.offerId) } } });
  await prisma.rawOffer.deleteMany({ where: { externalId: { startsWith: "test-" } } });
  await prisma.companySource.deleteMany({ where: { slug: { startsWith: "test-" } } });
  await prisma.companySource.deleteMany({ where: { slug: "TestAcme" } });
  await prisma.company.deleteMany({ where: { normalizedName: { startsWith: "test " } } });
  await prisma.collectorRun.deleteMany({ where: { connector: "test-greenhouse" } });
  await prisma.$disconnect();
});

const collectAll = async (ats: string, slug: string, known?: KnownOffers) => {
  const records: CollectedRecord[] = [];
  const stillListed: string[] = [];
  for await (const record of findAdapter(ats)!.collect(slug, "Test Acme", known)) {
    if ("stillListed" in record) stillListed.push(record.stillListed);
    else records.push(record);
  }
  return Object.assign(records, { stillListed });
};

describe("ATS mapping helpers", () => {
  test("France detection and French cities", () => {
    for (const text of ["Paris, France", "Remote - France", "Lyon", "Île-de-France", "Boulogne-Billancourt, IDF"]) assert.ok(mentionsFrance(text), text);
    for (const text of ["London, UK", "Remote EMEA", "Brussels", null]) assert.ok(!mentionsFrance(text), String(text));
    assert.equal(frenchCity("Paris, France"), "paris");
    assert.equal(frenchCity("Remote - France"), null);
    assert.equal(frenchCity("France - Paris"), "paris");
    assert.equal(frenchCity(" Sanary-sur-mer "), "Sanary-sur-mer", "a town missing from the list: the text itself");
    assert.equal(frenchCity("Mandelieu la napoule, France"), "Mandelieu la napoule");
    assert.equal(frenchCity("Multiple locations"), null);
    assert.equal(frenchCity("France (télétravail)"), null);
  });

  test("contract and remote only from explicit words", () => {
    assert.equal(contractFrom("Développeur React (CDI)"), "permanent");
    assert.equal(contractFrom("Stage - Data analyst"), "internship");
    assert.equal(contractFrom("Alternance développeur"), "apprenticeship");
    assert.equal(contractFrom("Software Engineer", "Full time"), null);
    assert.equal(remoteFrom("Paris (hybrid)"), "hybrid");
    assert.equal(remoteFrom("Remote - France"), "remote");
    assert.equal(salaryPeriod("per-year-salary"), "year");
    assert.equal(salaryPeriod("1 MONTH"), "month");
    assert.equal(nameFromSlug("back-market"), "Back Market");
  });
});

describe("adapters", () => {
  test("Greenhouse: French offers only, entity-encoded HTML decoded", async () => {
    greenhouseJobs = [greenhouseJob(1, "Paris, France"), greenhouseJob(2, "New York, US"), greenhouseJob(3, "Remote", { offices: [{ name: "Lyon" }], title: "Stage Data" })];
    assert.deepEqual(await findAdapter("greenhouse")!.check("test-acme"), { companyName: "Test Acme", jobCount: 3, franceJobCount: 2 });
    const records = await collectAll("greenhouse", "test-acme");
    assert.deepEqual(records.map((record) => record.offer.externalId), ["test-acme:1", "test-acme:3"]);
    const offer = records[0].offer;
    assert.equal(offer.description.format, "html");
    assert.match(offer.description.content, /^<h2><strong>Le poste<\/strong><\/h2>/);
    assert.deepEqual([offer.location?.city, offer.location?.countryCode, offer.language, offer.contractType], ["paris", "FR", "fr", null]);
    assert.equal(records[1].offer.contractType, "internship");
  });

  test("Ashby: country names, secondary locations, unlisted offers, salary, workplace", async () => {
    const records = await collectAll("ashby", "test-acme");
    assert.deepEqual(records.map((record) => record.offer.externalId), ["test-acme:a1", "test-acme:a3"]);
    const [designer, intern] = records.map((record) => record.offer);
    assert.deepEqual(designer.salary, { min: 50000, max: 60000, currency: "EUR", period: "year" });
    assert.deepEqual([designer.remote, designer.location?.city, designer.applyUrl], ["hybrid", "Paris", "https://jobs.ashbyhq.com/test-acme/a1/application"]);
    assert.equal(intern.contractType, "internship");
  });

  test("Lever: country code, lists in the description, salary range, commitment", async () => {
    const records = await collectAll("lever", "test-acme");
    assert.equal(records.length, 1);
    const offer = records[0].offer;
    assert.deepEqual([offer.contractType, offer.remote, offer.salary?.period, offer.location?.city], ["permanent", "remote", "year", "nantes"]);
    assert.match(offer.description.content, /<h3>Profil<\/h3><ul><li>Node\.js<\/li>/);
    assert.equal(offer.publishedAt, new Date(1790000000000).toISOString());
  });

  test("SmartRecruiters: France filter, detail sections, coordinates", async () => {
    assert.deepEqual(await findAdapter("smartrecruiters")!.check("TestAcme"), { companyName: "Test Acme SR", jobCount: 3, franceJobCount: 3 });
    const records = await collectAll("smartrecruiters", "TestAcme");
    assert.equal(records.length, 2, "an offer removed before its detail request is skipped, not fatal");
    const offer = records[0].offer;
    assert.match(offer.description.content, /^<h2>L'entreprise<\/h2><p>Test Acme<\/p>\n<h2>Le poste<\/h2>/);
    assert.deepEqual([offer.contractType, offer.remote, offer.location?.latitude, offer.company?.name], ["apprenticeship", "hybrid", 43.6, "Test Acme SR"]);
  });

  test("SmartRecruiters: known offers with the same release date skip their detail request", async () => {
    const refreshDays = collectorConfig.ats.detailRefreshDays;
    try {
      collectorConfig.ats.detailRefreshDays = 1_000_000_000; // no weekly refresh today
      const known: KnownOffers = new Map([["TestAcme:s1", null], ["TestAcme:s2", "2026-01-01T00:00:00Z"]]);
      const records = await collectAll("smartrecruiters", "TestAcme", known);
      assert.deepEqual(records.stillListed, ["TestAcme:s1"]);
      assert.deepEqual(records.map((record) => record.offer.externalId), ["TestAcme:s2"], "another release date: fetched again");

      collectorConfig.ats.detailRefreshDays = 1; // the refresh day of every offer
      assert.deepEqual((await collectAll("smartrecruiters", "TestAcme", known)).stillListed, []);
    } finally {
      collectorConfig.ats.detailRefreshDays = refreshDays;
    }
  });
});

describe("Workable and Recruitee", () => {
  test("Workable: France only, internship, apply link", async () => {
    assert.deepEqual(await findAdapter("workable")!.check("test-acme"), { companyName: "Test Acme W", jobCount: 2, franceJobCount: 1 });
    const records = await collectAll("workable", "test-acme");
    assert.equal(records.length, 1);
    const offer = records[0].offer;
    assert.deepEqual([offer.externalId, offer.location?.city, offer.contractType, offer.publishedAt], ["test-acme:W1", "Lille", "internship", "2026-10-05T00:00:00.000Z"]);
  });

  test("Recruitee: France only, contract code, salary, requirements in the description", async () => {
    assert.deepEqual(await findAdapter("recruitee")!.check("test-acme"), { companyName: "Test Acme R", jobCount: 2, franceJobCount: 1 });
    const [{ offer }] = await collectAll("recruitee", "test-acme");
    assert.deepEqual(
      [offer.location?.city, offer.location?.postcode, offer.contractType, offer.remote, offer.salary, offer.publishedAt],
      ["Bordeaux", "33000", "permanent", "hybrid", { min: 48000, max: 58000, currency: "EUR", period: "year" }, "2026-10-06T09:30:00.000Z"],
    );
    assert.match(offer.description.content, /Kubernetes/);
    assert.equal(findAdapter("recruitee")!.discovery!.slugFromUrl(new URL("https://test-acme.recruitee.com/o/dev")), "test-acme");
    assert.equal(findAdapter("recruitee")!.discovery!.slugFromUrl(new URL("https://www.recruitee.com/")), null);
  });
});

describe("discovery and board checks", () => {
  test("board ids from Common Crawl index lines", () => {
    const lines = ['{"url":"https://boards.greenhouse.io/embed/job_board?for=test-embedded"}', '{"url":"https://boards.greenhouse.io/test-path/jobs/1"}', '{"url":"https://boards.greenhouse.io/robots.txt"}'].join("\n");
    assert.deepEqual([...slugsFromIndexLines(findAdapter("greenhouse")!, lines)], ["test-embedded", "test-path"]);
  });

  test("discovery adds candidates once", async () => {
    const result = await discoverBoards(findAdapter("ashby")!, { log: () => {} });
    assert.deepEqual(result, { found: 2, added: 2, failedPrefixes: [] });
    assert.deepEqual((await discoverBoards(findAdapter("ashby")!, { log: () => {} })).added, 0);
    const board = await prisma.companySource.findUniqueOrThrow({ where: { ats_slug: { ats: "ashby", slug: "test-disc-one" } } });
    assert.deepEqual([board.status, board.discoveredFrom], ["candidate", "commoncrawl:CC-TEST"]);
  });

  test("board ids differing only by letter case are one board", async () => {
    await prisma.companySource.createMany({
      data: [
        { ats: "smartrecruiters", slug: "test-Case", status: "active" },
        { ats: "smartrecruiters", slug: "test-case", status: "active" },
      ],
    });
    await checkBoards({ ats: "none", where: TEST_BOARDS, log: () => {} });
    const rows = await prisma.companySource.findMany({ where: { ats: "smartrecruiters", slug: { in: ["test-Case", "test-case"] } }, orderBy: { slug: "asc" } });
    assert.deepEqual(rows.map((row) => row.status).sort(), ["active", "duplicate"]);

    const lines = '{"url":"https://jobs.ashbyhq.com/TEST-DISC-ONE/1"}';
    assert.equal(slugsFromIndexLines(findAdapter("ashby")!, lines).size, 1);
  });

  test("checks give each board a status; active boards get their company", async () => {
    for (const slug of ["test-acme", "test-abroad", "test-empty", "test-gone"]) {
      await prisma.companySource.upsert({ where: { ats_slug: { ats: "greenhouse", slug } }, create: { ats: "greenhouse", slug, status: "candidate" }, update: { status: "candidate" } });
    }
    await checkBoards({ ats: "greenhouse", where: TEST_BOARDS, log: () => {} });
    const boards = await prisma.companySource.findMany({ where: { ats: "greenhouse", slug: { startsWith: "test-" } }, include: { company: true }, orderBy: { slug: "asc" } });
    assert.deepEqual(
      boards.map((board) => [board.slug, board.status, board.franceJobCount, board.company?.name ?? null]),
      [
        ["test-abroad", "no-france", 0, null],
        ["test-acme", "active", 2, "Test Acme"],
        ["test-empty", "empty", 0, null],
        ["test-gone", "invalid", null, null],
      ],
    );
  });
});

describe("ATS connector runs", () => {
  test("collects active boards, closes offers that disappeared, keeps everything when the board fails", async () => {
    const connector = atsConnector(findAdapter("greenhouse")!, { where: TEST_BOARDS, key: "test-greenhouse" });
    greenhouseJobs = [greenhouseJob(1, "Paris, France"), greenhouseJob(3, "Lyon")];
    const first = await runConnector(connector, { log: () => {} });
    assert.equal(first.counts.created, 2);
    const offer = await prisma.offerSource.findUniqueOrThrow({ where: { source_externalId: { source: "greenhouse", externalId: "test-acme:1" } }, include: { offer: { include: { company: true } } } });
    assert.deepEqual([offer.offer.isPublic, offer.offer.company?.name, offer.offer.source], [true, "Test Acme", "greenhouse"]);

    // Job 3 is gone: closed. The board failing afterwards closes nothing.
    greenhouseJobs = [greenhouseJob(1, "Paris, France")];
    await runConnector(connector, { log: () => {} });
    const closed = await prisma.offerSource.findUniqueOrThrow({ where: { source_externalId: { source: "greenhouse", externalId: "test-acme:3" } }, include: { offer: true } });
    assert.ok(closed.closedAt && closed.offer.closedAt);

    failing = true;
    try {
      await runConnector(connector, { log: () => {} });
    } finally {
      failing = false;
    }
    const still = await prisma.offerSource.findUniqueOrThrow({ where: { source_externalId: { source: "greenhouse", externalId: "test-acme:1" } } });
    assert.equal(still.closedAt, null);
    const board = await prisma.companySource.findUniqueOrThrow({ where: { ats_slug: { ats: "greenhouse", slug: "test-acme" } } });
    assert.match(board.lastError ?? "", /HTTP 500/);
    assert.equal(board.status, "active");
  });
});
