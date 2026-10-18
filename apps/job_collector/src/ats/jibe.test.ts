import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import { backendConfig, prisma } from "@job/backend";
import { collectorConfig } from "../config";
import { resetCrawler } from "../crawler/fetcher";
import { runConnector } from "../runs/run-connector";
import { jibe } from "./adapters/jibe";
import { atsConnector } from "./connector";

// A local iCIMS / Jibe career site: its JSON job list filtered on France (two jobs a page
// whatever the limit) and offer pages with JobPosting. Its board is "127.0.0.1:<port>".

const LONG = "Vous accompagnerez nos clients particuliers et professionnels dans leurs projets d'assurance. ".repeat(3);
type Job = { slug: string; title: string; city: string; postal_code: string; country_code: "FR" | "GB"; posted_date: string; update_date: string; tags2: string[] };
let jobs: Job[] = [];
let requests: string[] = [];
let server: http.Server;
let slug: string;
const TEST_BOARD = () => ({ ats: "jibe", slug });

function route(path: string, params: URLSearchParams): [number, string, string] {
  if (path === "/robots.txt") return [200, "text/plain", "User-agent: *\nAllow: /\n"];
  if (path === "/api/jobs") {
    const listed = jobs.filter((job) => params.get("country") !== "France" || job.country_code === "FR");
    const page = Number(params.get("page") ?? 1);
    const body = { totalCount: listed.length, jobs: listed.slice((page - 1) * 2, page * 2).map((job) => ({ data: { ...job, req_id: job.slug, description: "UN SEUL PARAGRAPHE " + LONG, full_location: `${job.city}, France` } })) };
    return [200, "application/json; charset=utf-8", JSON.stringify(body)];
  }
  const job = jobs.find((item) => path === `/jobs/${item.slug}`);
  if (job) {
    const posting = { "@context": "http://schema.org", "@type": "JobPosting", title: job.title, description: `<h2>Vos missions</h2><p>${LONG}</p>`, employmentType: "FULL_TIME" };
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
  slug = `127.0.0.1:${(server.address() as AddressInfo).port}`;
  Object.assign(collectorConfig.crawler, { scheme: "http", minDelayMs: 0, allowedPrivateAddresses: ["127.0.0.1"], maxOfferPagesPerRun: 1000 });
  collectorConfig.ats.pauseBetweenBoardsMs = 0;
  collectorConfig.ats.detailRefreshDays = 1_000_000_000;
  backendConfig.geoapify.apiKey = undefined;
});

after(async () => {
  server.close();
  const sources = await prisma.offerSource.findMany({ where: { source: "jibe", externalId: { startsWith: slug } }, select: { offerId: true } });
  await prisma.offer.deleteMany({ where: { id: { in: sources.map((row) => row.offerId) } } });
  await prisma.rawOffer.deleteMany({ where: { source: "jibe", externalId: { startsWith: slug } } });
  const board = await prisma.companySource.findUnique({ where: { ats_slug: TEST_BOARD() } });
  await prisma.companySource.deleteMany({ where: TEST_BOARD() });
  if (board?.companyId) await prisma.company.deleteMany({ where: { id: board.companyId } });
  await prisma.collectorRun.deleteMany({ where: { connector: "test-jibe" } });
  await prisma.$disconnect();
});

describe("Jibe runs", () => {
  test("France only, page after page; the page's HTML description; updated offers read again; offers gone are closed", async () => {
    resetCrawler();
    jobs = [
      { slug: "101", title: "Conseiller clientèle (F/H)", city: "NANTERRE", postal_code: "92000", country_code: "FR", posted_date: "2026-10-16T10:00:00+0000", update_date: "2026-10-16T13:20:54+0000", tags2: ["Permanent"] },
      { slug: "102", title: "Chargé de projets RSE (F/H) en stage", city: "PUTEAUX", postal_code: "92800", country_code: "FR", posted_date: "2026-10-15T10:00:00+0000", update_date: "2026-10-15T10:00:00+0000", tags2: ["Internship"] },
      { slug: "103", title: "Gestionnaire sinistres (F/H)", city: "35-ILLE-ET-VILAINE", postal_code: "", country_code: "FR", posted_date: "2026-10-14T10:00:00+0000", update_date: "2026-10-14T10:00:00+0000", tags2: [] },
      { slug: "201", title: "Underwriter", city: "LONDON", postal_code: "", country_code: "GB", posted_date: "2026-10-16T10:00:00+0000", update_date: "2026-10-16T10:00:00+0000", tags2: [] },
    ];
    await prisma.companySource.create({ data: { ...TEST_BOARD(), status: "candidate" } });
    assert.equal((await jibe.check(slug)).franceJobCount, 3);
    await prisma.companySource.update({ where: { ats_slug: TEST_BOARD() }, data: { status: "active", company: { create: { name: "Test Jibe", normalizedName: "test jibe" } } } });
    const connector = atsConnector(jibe, { where: TEST_BOARD(), key: "test-jibe" });
    const offer = (id: string) => prisma.offerSource.findUniqueOrThrow({ where: { source_externalId: { source: "jibe", externalId: `${slug}:${id}` } }, include: { offer: true } });

    requests = [];
    const first = await runConnector(connector, { log: () => {} });
    assert.equal(first.counts.created, 3);
    assert.ok(requests.some((path) => path.startsWith("/api/jobs?country=France&page=2")), "the next page of the list");
    assert.ok(!requests.some((path) => path.startsWith("/jobs/201")), "offers abroad are never opened");
    const nanterre = (await offer("101")).offer;
    assert.match(nanterre.description, /^## Vos missions/, "the page's HTML, not the flattened text");
    assert.equal(nanterre.publishedAt?.toISOString(), "2026-10-16T10:00:00.000Z");
    assert.equal(nanterre.contractType, "permanent");
    assert.equal((await offer("102")).offer.contractType, "internship");

    // An updated offer is read again; the others are not.
    jobs[0].update_date = "2026-10-18T09:00:00+0000";
    requests = [];
    await runConnector(connector, { log: () => {} });
    assert.deepEqual(requests.filter((path) => path.startsWith("/jobs/")), ["/jobs/101?lang=fr-fr"]);

    jobs = jobs.filter((job) => job.slug !== "103");
    await runConnector(connector, { log: () => {} });
    assert.ok((await offer("103")).closedAt);
  });
});
