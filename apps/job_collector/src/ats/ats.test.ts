import assert from "node:assert/strict";
import http from "node:http";
import { gzipSync } from "node:zlib";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import { backendConfig, prisma } from "@job/backend";
import { collectorConfig } from "../config";
import { checkBoards, hostKey, isJobBoardFeed } from "../discovery/check-boards";
import { surtPrefixes } from "../discovery/cc-index";
import { boardsFromCaptures, discoverBoards } from "../discovery/common-crawl";
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
  if (path === "/v1/boards/test-acmelinkedin") return [200, { name: "LinkedIn Job Wrapping" }];
  if (path === "/v1/boards/test-acmelinkedin/jobs") return [200, { jobs: [greenhouseJob(21, "Paris, France")] }];
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
  // Common Crawl: the list of crawls, and the index files (cluster.idx and blocks)
  if (path === "/collinfo.json") return [200, [{ id: "CC-TEST" }]];
  if (path === "/cc-index/collections/CC-TEST/indexes/cluster.idx") return [200, CC_INDEX.cluster];
  if (path === "/cc-index/collections/CC-TEST/indexes/cdx-00000.gz") return [200, CC_INDEX.cdx];
  return [404, { error: "not found" }];
}

// A small Common Crawl index: gzip blocks of "SURT timestamp {json}" lines, and a
// cluster.idx with filler lines around them so the binary search has work to do.
const CC_INDEX = (() => {
  const capture = (surt: string, url: string, languages?: string) => `${surt} 20260901000000 ${JSON.stringify({ url, status: "200", ...(languages && { languages }) })}`;
  const blocks = [
    [capture("com,ashbyhq,api)/x", "https://api.ashbyhq.com/x"), capture("com,ashbyhq,jobs)/test-disc-one/123", "https://jobs.ashbyhq.com/test-disc-one/123", "fra,eng")],
    [capture("com,ashbyhq,jobs)/test-disc-one/456", "https://jobs.ashbyhq.com/test-disc-one/456"), capture("com,ashbyhq,jobs)/test-disc-two", "https://jobs.ashbyhq.com/test-disc-two", "eng"), "com,ashbyhq,jobs)/broken 20260901000000 not json", capture("com,ashbyhq,jobs)/robots.txt", "https://jobs.ashbyhq.com/robots.txt")],
    [capture("com,ashbyhqx)/", "https://ashbyhqx.com/")],
  ].map((lines) => gzipSync(lines.join("\n") + "\n"));
  const offsets = blocks.map((_, index) => blocks.slice(0, index).reduce((sum, block) => sum + block.length, 0));
  const entry = (key: string, block: number) => `${key} 20260901000000\tcdx-00000.gz\t${offsets[block]}\t${blocks[block].length}\t${block + 1}`;
  const filler = (from: string, count: number) => Array.from({ length: count }, (_, index) => `${from}${String(index).padStart(4, "0")} 20260901000000\tcdx-00000.gz\t0\t1\t0`);
  const cluster = [...filler("aaa,filler)/", 60), entry("com,ashbyhq,api)/x", 0), entry("com,ashbyhq,jobs)/test-disc-one/456", 1), entry("com,ashbyhqx)/", 2), ...filler("zzz,filler)/", 60)].join("\n") + "\n";
  return { cluster: Buffer.from(cluster), cdx: Buffer.concat(blocks) };
})();

let server: http.Server;

before(async () => {
  server = http.createServer((req, res) => {
    const [status, body] = route(new URL(req.url!, "http://localhost"));
    if (Buffer.isBuffer(body)) {
      // Index files: HEAD for the size, byte ranges like the real file server.
      const range = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range ?? "");
      const start = range ? Number(range[1]) : 0;
      if (range && start >= body.length) return void res.writeHead(416).end();
      const part = range ? body.subarray(start, Number(range[2]) + 1) : body;
      res.writeHead(range ? 206 : status, { "Content-Type": "application/octet-stream", "Content-Length": req.method === "HEAD" ? body.length : part.length });
      return void res.end(req.method === "HEAD" ? undefined : part);
    }
    res.writeHead(status, { "Content-Type": "application/json" }).end(typeof body === "string" ? body : JSON.stringify(body));
  });
  server.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  for (const ats of Object.keys(collectorConfig.ats.baseUrls)) collectorConfig.ats.baseUrls[ats] = base;
  collectorConfig.discovery.commonCrawlIndex = base;
  collectorConfig.discovery.commonCrawlData = base;
  collectorConfig.discovery.crawls = 1;
  collectorConfig.discovery.clusterChunkBytes = 64;
  collectorConfig.discovery.pauseBetweenBlocksMs = 0;
  collectorConfig.discovery.retryPauseMs = 0;
  collectorConfig.ats.pauseBetweenBoardsMs = 0;
  collectorConfig.ats.pauseBetweenRequestsMs = 0;
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
    else if (!("partialListing" in record)) records.push(record);
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
  test("index prefixes of an address or a domain", () => {
    assert.deepEqual(surtPrefixes("boards.greenhouse.io/", "prefix"), ["io,greenhouse,boards)/"]);
    assert.deepEqual(surtPrefixes("www.welcometothejungle.com/fr/companies/", "prefix"), ["com,welcometothejungle)/fr/companies/"]);
    assert.deepEqual(surtPrefixes("teamtailor.com", "domain"), ["com,teamtailor)", "com,teamtailor,"]);
  });

  test("board ids from captures, with their French pages", () => {
    const captures = [
      { url: "https://boards.greenhouse.io/embed/job_board?for=test-embedded", languages: "eng" },
      { url: "https://boards.greenhouse.io/test-path/jobs/1", languages: "eng" },
      { url: "https://boards.greenhouse.io/test-path/jobs/2", languages: "fra" },
      { url: "https://boards.greenhouse.io/robots.txt", languages: null },
      { url: "not a url", languages: null },
    ];
    assert.deepEqual([...boardsFromCaptures(findAdapter("greenhouse")!, captures)], [["test-embedded", { french: false }], ["test-path", { french: true }]]);
  });

  test("discovery reads the index files and adds candidates once", async () => {
    const result = await discoverBoards(findAdapter("ashby")!, { log: () => {} });
    assert.deepEqual(result, { found: 2, added: 2, french: 1, failedCrawls: [] });
    assert.deepEqual((await discoverBoards(findAdapter("ashby")!, { log: () => {} })).added, 0);
    const boards = await prisma.companySource.findMany({ where: { ats: "ashby", slug: { startsWith: "test-disc-" } }, orderBy: { slug: "asc" } });
    assert.deepEqual(boards.map((board) => [board.slug, board.status, board.discoveredFrom]), [
      ["test-disc-one", "candidate", "commoncrawl:CC-TEST:fr"],
      ["test-disc-two", "candidate", "commoncrawl:CC-TEST"],
    ]);
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

    const captures = [{ url: "https://jobs.ashbyhq.com/TEST-DISC-ONE/1", languages: null }];
    assert.equal(boardsFromCaptures(findAdapter("ashby")!, captures).size, 1);
  });

  test("concurrent checks: a board's host, else its tool's shared API", () => {
    assert.equal(hostKey({ ats: "workable", slug: "motork" }), "workable");
    assert.equal(hostKey({ ats: "smartrecruiters", slug: "COVEA1" }), "smartrecruiters");
    assert.equal(hostKey({ ats: "recruitee", slug: "fleurymichon" }), "fleurymichon.recruitee.com");
    assert.equal(hostKey({ ats: "workday", slug: "Babilou.wd3.myworkdayjobs.com/Babilou" }), "babilou.wd3.myworkdayjobs.com");
    assert.equal(hostKey({ ats: "careersite", slug: "join.com/companies/acme" }), "join.com");
    assert.equal(hostKey({ ats: "gestmax", slug: "127.0.0.1:8080" }), "127.0.0.1:8080");
  });

  test("job boards' feeds of an employer's offers; the job boards' own boards stay", () => {
    assert.ok(isJobBoardFeed("artefactlinkedin", "LinkedIn Job Wrapping"));
    assert.ok(isJobBoardFeed("artefactjobs", "Welcome to the Jungle"));
    assert.ok(isJobBoardFeed("teneolinkedin", "Teneo external feed for LinkedIn"));
    assert.ok(!isJobBoardFeed("linkedin", "LinkedIn"), "LinkedIn hiring for itself");
    assert.ok(!isJobBoardFeed("welcometothejungle", "Welcome to the Jungle"));
    assert.ok(!isJobBoardFeed("monsterenergy", "Monster Energy"));
  });

  test("an unreachable host: invalid only when it still is days later", async () => {
    const where = { ats_slug: { ats: "careersite", slug: "test-nowhere.invalid" } };
    await prisma.companySource.upsert({ where, create: { ats: "careersite", slug: "test-nowhere.invalid", status: "candidate" }, update: { status: "candidate", lastError: null, checkedAt: null } });
    await checkBoards({ ats: "careersite", where: { ...TEST_BOARDS, slug: "test-nowhere.invalid" }, limit: 1, log: () => {} });
    let board = await prisma.companySource.findUniqueOrThrow({ where });
    assert.equal(board.status, "candidate", "a first failure may be passing");
    assert.match(board.lastError ?? "", /unreachable|unknown host/);
    await prisma.companySource.update({ where, data: { checkedAt: new Date(Date.now() - 4 * 24 * 3600 * 1000) } });
    await checkBoards({ ats: "careersite", where: { ...TEST_BOARDS, slug: "test-nowhere.invalid" }, limit: 1, log: () => {} });
    board = await prisma.companySource.findUniqueOrThrow({ where });
    assert.equal(board.status, "invalid", "still unreachable days later");
    await prisma.companySource.delete({ where });
  });

  test("checks give each board a status; active boards get their company", async () => {
    for (const slug of ["test-acme", "test-abroad", "test-empty", "test-gone", "test-acmelinkedin"]) {
      await prisma.companySource.upsert({ where: { ats_slug: { ats: "greenhouse", slug } }, create: { ats: "greenhouse", slug, status: "candidate" }, update: { status: "candidate" } });
    }
    await checkBoards({ ats: "greenhouse", where: TEST_BOARDS, log: () => {} });
    const boards = await prisma.companySource.findMany({ where: { ats: "greenhouse", slug: { startsWith: "test-" } }, include: { company: true }, orderBy: { slug: "asc" } });
    assert.deepEqual(
      boards.map((board) => [board.slug, board.status, board.franceJobCount, board.company?.name ?? null]),
      [
        ["test-abroad", "no-france", 0, null],
        ["test-acme", "active", 2, "Test Acme"],
        ["test-acmelinkedin", "duplicate", 1, null],
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
