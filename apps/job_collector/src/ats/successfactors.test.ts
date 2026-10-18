import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import { backendConfig, prisma } from "@job/backend";
import { collectorConfig } from "../config";
import { resetCrawler } from "../crawler/fetcher";
import { runConnector } from "../runs/run-connector";
import { companyFromHost, descriptionContract, franceLocation, pageDate, pageDetails, parseFeed, successFactors } from "./adapters/successfactors";
import { atsConnector } from "./connector";

// A local SuccessFactors career site: robots.txt, the job feed (/googlefeed.xml) and offer
// pages in both layouts. Its board is "127.0.0.1:<port>" in the test database.

const LONG = "Vous rejoindrez l'équipe maintenance et interviendrez sur les installations de nos clients. ".repeat(3);
type Job = { id: string; title: string; location: string; layout: "tokens" | "schema"; date: string; contract?: string };
let jobs: Job[] = [];
let requests: string[] = [];
let server: http.Server;
let slug: string;
const TEST_BOARD = () => ({ ats: "successfactors", slug });

const jobPath = (job: Job) => `/job/${job.title.replace(/\W+/g, "-")}/${job.id}/`;
const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const feed = () =>
  `<?xml version="1.0" encoding="UTF-8" ?><rss version="2.0" xmlns:g="http://base.google.com/ns/1.0"><channel><title>Jobs</title>${jobs
    .map(
      (job) => `<item><title>${escape(job.title)} (${job.location})</title><description><![CDATA[${escape(`<p>${LONG}</p>`)}]]></description><link>http://${slug}${jobPath(job)}</link><g:id>${job.id}</g:id><g:location>${job.location}</g:location><g:employer>TEST ENTITY SAS</g:employer><g:expiration_date>2026-12-31</g:expiration_date></item>`,
    )
    .join("")}</channel></rss>`;
const token = (label: string, value: string) =>
  `<div class="joblayouttoken displayDTM"><div class="inner"><div class="row"><div class="col-xs-12">${label ? `<span class="joblayouttoken-label">${label}</span>` : ""}<span lang="fr-FR" class="rtltextaligneligible">${value}</span></div></div></div></div>`;
const jobPage = (job: Job) =>
  job.layout === "tokens"
    ? `<html lang="fr-FR"><body>${token("", job.title)}${token("Publié le:", job.date)}${job.contract ? token("Type de contrat:", job.contract) : ""}${token("", job.location)}<script>j2w.init({})</script></body></html>`
    : `<html lang="en-GB"><head><meta itemprop="datePosted" content="${job.date}"></head><body><h1 itemprop="title">${job.title}</h1></body></html>`;

function route(path: string): [number, string, string] {
  if (path === "/robots.txt") return [200, "text/plain", "User-agent: *\nDisallow: /services/\nDisallow: /applybutton/\n"];
  if (path === "/googlefeed.xml") return [200, "application/xml", feed()];
  const job = jobs.find((item) => path === jobPath(item));
  if (job) return [200, "text/html; charset=utf-8", jobPage(job)];
  return [404, "text/html", "not found"];
}

before(async () => {
  server = http.createServer((req, res) => {
    const path = new URL(req.url!, "http://localhost").pathname;
    requests.push(path);
    const [status, type, text] = route(path);
    res.writeHead(status, { "Content-Type": type }).end(text);
  });
  server.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  slug = `127.0.0.1:${(server.address() as AddressInfo).port}`;
  Object.assign(collectorConfig.crawler, { scheme: "http", minDelayMs: 0, allowedPrivateAddresses: ["127.0.0.1"] });
  collectorConfig.ats.pauseBetweenBoardsMs = 0;
  collectorConfig.ats.detailRefreshDays = 1_000_000_000; // no weekly refresh during the tests
  backendConfig.geoapify.apiKey = undefined;
});

after(async () => {
  server.close();
  const sources = await prisma.offerSource.findMany({ where: { source: "successfactors", externalId: { startsWith: slug } }, select: { offerId: true } });
  await prisma.offer.deleteMany({ where: { id: { in: sources.map((row) => row.offerId) } } });
  await prisma.rawOffer.deleteMany({ where: { source: "successfactors", externalId: { startsWith: slug } } });
  const board = await prisma.companySource.findUnique({ where: { ats_slug: TEST_BOARD() } });
  await prisma.companySource.deleteMany({ where: TEST_BOARD() });
  if (board?.companyId) await prisma.company.deleteMany({ where: { id: board.companyId } });
  await prisma.collectorRun.deleteMany({ where: { connector: "test-successfactors" } });
  await prisma.$disconnect();
});

describe("SuccessFactors feed and pages", () => {
  test("places in France, whatever the order of their parts", () => {
    assert.deepEqual(franceLocation("Paris, FR, 75001"), { city: "Paris", postcode: "75001", countyCode: "75" });
    assert.deepEqual(franceLocation("Semeac, 65, FR"), { city: "Semeac", postcode: null, countyCode: "65" });
    assert.deepEqual(franceLocation("Crespin, FR"), { city: "Crespin", postcode: null, countyCode: null });
    for (const abroad of ["Mahora Albacete, ES, 2240", "Hamburg, HH, DE", "Utrecht, NL", "Fresno, CA, US"]) assert.equal(franceLocation(abroad), null, abroad);
  });

  test("dates in the formats seen on the pages", () => {
    assert.equal(pageDate("12/01/2026", "fr-FR"), "2026-01-12");
    assert.equal(pageDate("1/12/2026", "en-US"), "2026-01-12");
    assert.equal(pageDate("23 sept. 2026", "fr-FR"), "2026-09-23");
    assert.equal(pageDate("Sep 23, 2026", "en-GB"), "2026-09-23");
    assert.equal(pageDate("Mon Sep 21 00:00:00 UTC 2026", "en-GB"), "2026-09-21");
    assert.equal(pageDate("bientôt", "fr-FR"), null);
  });

  test("the feed: title without its place, the description unescaped, entities decoded", () => {
    jobs = [{ id: "11", title: "Ingénieur d'études R&D", location: "Lyon, FR, 69001", layout: "tokens", date: "01/10/2026" }];
    const [item] = parseFeed(feed());
    assert.equal(item.title, "Ingénieur d'études R&D");
    assert.match(item.description, /^<p>Vous rejoindrez/);
    assert.equal(item.employer, "TEST ENTITY SAS");
  });

  test("page fields: labelled blocks and the older schema.org layout; contracts", () => {
    const tokens = pageDetails(jobPage({ id: "1", title: "Technicien", location: "Paris, FR", layout: "tokens", date: "12/01/2026", contract: "CDI" }));
    assert.deepEqual([tokens.publishedAt, tokens.contract], ["2026-01-12", "CDI"]);
    assert.equal(pageDetails(jobPage({ id: "2", title: "Soudeur", location: "Belfort, FR", layout: "schema", date: "Mon Sep 21 00:00:00 UTC 2026" })).publishedAt, "2026-09-21");
    assert.equal(descriptionContract("<p>Poste en CDI basé à Lyon</p>"), "permanent");
    assert.equal(descriptionContract("<p>À ce stage du projet, vous…</p>"), null, "'stage' alone is not a contract");
    assert.equal(companyFromHost("jobsearch.alstom.com"), "Alstom");
    assert.equal(companyFromHost("careers.capgemini.com"), "Capgemini");
  });
});

describe("SuccessFactors runs", () => {
  test("France only; each new offer's page read once for its date; budget per run; offers gone are closed", async () => {
    resetCrawler();
    jobs = [
      { id: "1001", title: "Technicien de maintenance (F/H)", location: "Lyon, FR, 69003", layout: "tokens", date: "12/10/2026", contract: "CDI" },
      { id: "1002", title: "Monteur soudeur (F/H)", location: "Belfort, 90, FR", layout: "schema", date: "Mon Sep 21 00:00:00 UTC 2026" },
      { id: "1003", title: "Ingénieur stage (F/H)", location: "Nantes, FR, 44000", layout: "tokens", date: "01/10/2026" },
      { id: "2001", title: "Site Engineer", location: "Hamburg, HH, DE", layout: "tokens", date: "12/10/2026" },
    ];
    await prisma.companySource.create({ data: { ...TEST_BOARD(), status: "candidate" } });
    const check = await successFactors.check(slug);
    assert.deepEqual([check.jobCount, check.franceJobCount], [4, 3]);
    await prisma.companySource.update({ where: { ats_slug: TEST_BOARD() }, data: { status: "active", company: { create: { name: "Test SF", normalizedName: "test sf" } } } });
    const connector = atsConnector(successFactors, { where: TEST_BOARD(), key: "test-successfactors" });

    // A budget of 2 pages: the third offer is saved without its date.
    collectorConfig.crawler.maxOfferPagesPerRun = 2;
    requests = [];
    const first = await runConnector(connector, { log: () => {} });
    assert.equal(first.counts.created, 3);
    assert.ok(!requests.some((path) => path.includes("Site-Engineer")), "offers abroad are never opened");
    const offer = (id: string) => prisma.offerSource.findUniqueOrThrow({ where: { source_externalId: { source: "successfactors", externalId: `${slug}:${id}` } }, include: { offer: { include: { company: true } } } });
    const lyon = await offer("1001");
    assert.equal(lyon.offer.publishedAt?.toISOString(), "2026-10-12T00:00:00.000Z");
    assert.equal(lyon.offer.contractType, "permanent");
    assert.equal(lyon.offer.company?.name, "Test SF", "the board's company, not the legal entity of the feed");
    assert.equal((await offer("1002")).offer.publishedAt?.toISOString(), "2026-09-21T00:00:00.000Z");
    assert.equal((await offer("1003")).offer.publishedAt, null, "over the budget: saved, dated later");

    // Next run: only the undated offer's page is read.
    collectorConfig.crawler.maxOfferPagesPerRun = 1000;
    requests = [];
    await runConnector(connector, { log: () => {} });
    assert.deepEqual(requests.filter((path) => path.startsWith("/job/")), [jobPath(jobs[2])]);
    assert.equal((await offer("1003")).offer.publishedAt?.toISOString(), "2026-10-01T00:00:00.000Z");

    // Then nothing is read again, and an offer missing from the feed is closed.
    jobs = jobs.filter((job) => job.id !== "1002");
    requests = [];
    await runConnector(connector, { log: () => {} });
    assert.equal(requests.filter((path) => path.startsWith("/job/")).length, 0);
    assert.ok((await offer("1002")).closedAt);
  });
});
