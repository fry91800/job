import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import { backendConfig, prisma } from "@job/backend";
import { collectorConfig } from "../config";
import { resetCrawler } from "../crawler/fetcher";
import { runConnector } from "../runs/run-connector";
import { phenom, phenomData, phenomDate } from "./adapters/phenom";
import { atsConnector } from "./connector";

// A local Phenom career site: its search page with the results as JSON in the page (two
// offers per page whatever the size asked, its own "FRANCE" value in the country filter) and
// offer pages with JobPosting. Its board is "127.0.0.1:<port>/fr/fr" in the test database.

const LONG = "Vous rejoindrez l'équipe logistique et piloterez les flux de notre plateforme régionale. ".repeat(3);
type Job = { jobId: string; title: string; city: string; country: "FRANCE" | "GERMANY"; postedDate: string; contractType: string };
let jobs: Job[] = [];
let requests: string[] = [];
let server: http.Server;
let slug: string;
const TEST_BOARD = () => ({ ats: "phenom", slug });

function searchPage(params: URLSearchParams): string {
  const country = params.get("qcountry");
  const listed = jobs.filter((job) => !country || job.country === country).sort((a, b) => b.postedDate.localeCompare(a.postedDate));
  const from = Number(params.get("from") ?? 0);
  const ddo = {
    siteConfig: { status: 200 },
    eagerLoadRefineSearch: {
      status: 200,
      totalHits: listed.length,
      data: {
        jobs: listed.slice(from, from + 2).map((job) => ({ ...job, location: `${job.city}, ${job.country}` })),
        aggregations: [{ field: "country", value: { FRANCE: jobs.filter((job) => job.country === "FRANCE").length, GERMANY: 1 } }],
      },
    },
  };
  return `<html><head><script>var phApp = phApp || {}; phApp.ddo = ${JSON.stringify(ddo)}; phApp.experimentData = {};</script></head><body></body></html>`;
}

function route(path: string, params: URLSearchParams): [number, string, string] {
  if (path === "/robots.txt") return [200, "text/plain", "User-agent: *\nDisallow: */apply\nDisallow: */jobcart\n"];
  if (path === "/fr/fr/search-results") return [200, "text/html", searchPage(params)];
  const job = jobs.find((item) => path === `/fr/fr/job/${item.jobId}`);
  if (job) {
    const posting = { "@context": "http://schema.org", "@type": "JobPosting", title: job.title, description: `&lt;p&gt;${LONG}&lt;/p&gt;`, datePosted: job.postedDate.slice(0, 10) };
    return [200, "text/html", `<html><head><script type="application/ld+json">${JSON.stringify(posting)}</script></head></html>`];
  }
  return [404, "text/html", "not found"];
}

before(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url!, "http://localhost");
    requests.push(url.pathname + url.search);
    const [status, type, text] = route(url.pathname, url.searchParams);
    res.writeHead(status, { "Content-Type": type }).end(text);
  });
  server.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  slug = `127.0.0.1:${(server.address() as AddressInfo).port}/fr/fr`;
  Object.assign(collectorConfig.crawler, { scheme: "http", minDelayMs: 0, allowedPrivateAddresses: ["127.0.0.1"] });
  collectorConfig.ats.pauseBetweenBoardsMs = 0;
  collectorConfig.ats.detailRefreshDays = 1_000_000_000;
  backendConfig.geoapify.apiKey = undefined;
});

after(async () => {
  server.close();
  const sources = await prisma.offerSource.findMany({ where: { source: "phenom", externalId: { startsWith: slug } }, select: { offerId: true } });
  await prisma.offer.deleteMany({ where: { id: { in: sources.map((row) => row.offerId) } } });
  await prisma.rawOffer.deleteMany({ where: { source: "phenom", externalId: { startsWith: slug } } });
  const board = await prisma.companySource.findUnique({ where: { ats_slug: TEST_BOARD() } });
  await prisma.companySource.deleteMany({ where: TEST_BOARD() });
  if (board?.companyId) await prisma.company.deleteMany({ where: { id: board.companyId } });
  await prisma.collectorRun.deleteMany({ where: { connector: "test-phenom" } });
  await prisma.$disconnect();
});

describe("Phenom pages", () => {
  test("the page's data, whatever follows it; dates with an offset without colon", () => {
    assert.deepEqual(phenomData(`<script>phApp.ddo = {"a":{"b":"x}y"}}; phApp.other = {};</script>`), { a: { b: "x}y" } });
    assert.equal(phenomData("<html></html>"), null);
    assert.equal(phenomDate("2025-12-23T11:18:53.000+0000"), "2025-12-23T11:18:53.000Z");
  });
});

describe("Phenom runs", () => {
  test("France only, page after page; a new offer's page read once; budget; offers gone are closed", async () => {
    resetCrawler();
    jobs = [
      { jobId: "J1", title: "Chef d'équipe logistique (F/H) - CDI", city: "AMILLY", country: "FRANCE", postedDate: "2026-10-09T15:48:37.040+0000", contractType: "CDI" },
      { jobId: "J2", title: "Agent de quai (F/H)", city: "LOGNES", country: "FRANCE", postedDate: "2026-10-08T10:00:00.000+0000", contractType: "CDD" },
      { jobId: "J3", title: "Stage contrôle de gestion", city: "ROISSY-EN-FRANCE", country: "FRANCE", postedDate: "2026-10-07T10:00:00.000+0000", contractType: "Stage" },
      { jobId: "D1", title: "Lagerist", city: "BONN", country: "GERMANY", postedDate: "2026-10-09T10:00:00.000+0000", contractType: "Permanent" },
    ];
    await prisma.companySource.create({ data: { ...TEST_BOARD(), status: "candidate" } });
    const check = await phenom.check(slug);
    assert.deepEqual([check.jobCount, check.franceJobCount], [4, 3]);
    await prisma.companySource.update({ where: { ats_slug: TEST_BOARD() }, data: { status: "active", company: { create: { name: "Test Phenom", normalizedName: "test phenom" } } } });
    const connector = atsConnector(phenom, { where: TEST_BOARD(), key: "test-phenom" });
    const offer = (id: string) => prisma.offerSource.findUniqueOrThrow({ where: { source_externalId: { source: "phenom", externalId: `${slug}:${id}` } }, include: { offer: { include: { location: true } } } });

    // A budget of 2 pages: the third offer waits for the next run, and nothing is closed.
    collectorConfig.crawler.maxOfferPagesPerRun = 2;
    requests = [];
    const first = await runConnector(connector, { log: () => {} });
    assert.equal(first.counts.created, 2);
    assert.ok(requests.some((path) => path.includes("qcountry=FRANCE") && path.includes("sortBy=Most+recent")), "filtered on the site's own France value, newest first");
    assert.ok(requests.some((path) => path.includes("from=2")), "the next page of results");
    assert.ok(!requests.some((path) => path.includes("/job/D1")), "offers abroad are never opened");
    const amilly = await offer("J1");
    assert.equal(amilly.offer.publishedAt?.toISOString(), "2026-10-09T15:48:37.040Z");
    assert.equal(amilly.offer.contractType, "permanent");
    assert.match(amilly.offer.description, /^Vous rejoindrez/);

    collectorConfig.crawler.maxOfferPagesPerRun = 1000;
    requests = [];
    await runConnector(connector, { log: () => {} });
    assert.deepEqual(requests.filter((path) => path.includes("/job/")), ["/fr/fr/job/J3"], "only the offer that waited");
    assert.equal((await offer("J3")).offer.contractType, "internship");

    jobs = jobs.filter((job) => job.jobId !== "J2");
    await runConnector(connector, { log: () => {} });
    assert.ok((await offer("J2")).closedAt);
  });
});
