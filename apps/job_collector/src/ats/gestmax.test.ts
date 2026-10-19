import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import { backendConfig, prisma } from "@job/backend";
import { collectorConfig } from "../config";
import { resetCrawler } from "../crawler/fetcher";
import { runConnector } from "../runs/run-connector";
import { gestmax, gestmaxListPage, gestmaxOffer, resetGestmaxMemory } from "./adapters/gestmax";
import { atsConnector } from "./connector";

// A local Gestmax site: /search redirecting to its list (two offers a page, page links),
// offer pages with Gestmax's field classes. Its board is "127.0.0.1:<port>".

const LONG = "Vous réalisez les opérations de livraison et de reprise selon la feuille de route. ".repeat(2);
type Job = { id: string; title: string; city: string; contract: string; date: string; country?: string };
let jobs: Job[] = [];
let requests: string[] = [];
let server: http.Server;
let slug: string;
const TEST_BOARD = () => ({ ats: "gestmax", slug });

const card = (job: Job) =>
  `<a href="http://${slug}/${job.id}/1/${job.title.toLowerCase().replace(/\W+/g, "-")}" class="list-group-item"><h3 class="list-group-item-heading">${job.title} <span class="sr-only">(Nouvelle fenêtre)</span></h3><div class="list-group-item-data"><span class="listdiv-span listspan-vac_job_type">${job.contract}</span><span class="listdiv-span listspan-vac_lieu_geographique">${job.city}</span></div><div class="listdiv-date">${job.date}</div></a>`;
const page = (job: Job) =>
  `<html><head><meta property="og:site_name" content="Test Gestmax"></head><body class="gestmax-template"><div class="title-stripe"><h1>${job.title}</h1><div class="title-city">${job.city}</div></div>` +
  `<div class="details">${job.country ? `<p class="field-vac_pays"><span>Pays</span><br />${job.country}</p>` : ""}<p class="field-vac_type_contrat"><span>Type de contrat</span><br />${job.contract}</p></div>` +
  `<div class="vacancy-text"><h3 class="field field-vac_descriptif">Descriptif de l'offre</h3><div class="text field-value-vac_descriptif"><p>${LONG}</p></div><div class="text field-value-cust_footer"><p>Pied de page</p></div></div></body></html>`;

function route(path: string, query: string): [number, Record<string, string>, string] {
  if (path === "/robots.txt") return [404, { "Content-Type": "text/html" }, "not found"];
  if (path === "/search") return [302, { Location: "/search/1-liste-d-offres" }, ""];
  if (path === "/search/1-liste-d-offres") {
    const number = Number(/page=(\d+)/.exec(query)?.[1] ?? 1);
    const pages = Math.ceil(jobs.length / 2);
    const links = Array.from({ length: pages }, (_, index) => `<a href="/search/1-liste-d-offres?page=${index + 1}">${index + 1}</a>`).join("");
    return [200, { "Content-Type": "text/html" }, `<html><body><!-- gestmax -->${jobs.slice((number - 1) * 2, number * 2).map(card).join("")}${links}</body></html>`];
  }
  const job = jobs.find((item) => path.startsWith(`/${item.id}/`));
  if (job) return [200, { "Content-Type": "text/html" }, page(job)];
  return [404, { "Content-Type": "text/html" }, "not found"];
}

before(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url!, "http://localhost");
    requests.push(url.pathname);
    const [status, headers, text] = route(url.pathname, url.search);
    res.writeHead(status, headers).end(text);
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
  const sources = await prisma.offerSource.findMany({ where: { source: "gestmax", externalId: { startsWith: slug } }, select: { offerId: true } });
  await prisma.offer.deleteMany({ where: { id: { in: sources.map((row) => row.offerId) } } });
  await prisma.rawOffer.deleteMany({ where: { source: "gestmax", externalId: { startsWith: slug } } });
  const board = await prisma.companySource.findUnique({ where: { ats_slug: TEST_BOARD() } });
  await prisma.companySource.deleteMany({ where: TEST_BOARD() });
  if (board?.companyId) await prisma.company.deleteMany({ where: { id: board.companyId } });
  await prisma.collectorRun.deleteMany({ where: { connector: "test-gestmax" } });
  await prisma.$disconnect();
});

describe("Gestmax pages", () => {
  test("title, city, contract and texts under their headings; another country skipped", () => {
    const listed = { id: "16503", url: "https://x.gestmax.fr/16503/1/a", title: "Conducteur PL (H/F)", date: "2026-10-16", contract: null, place: null };
    const job = { id: "16503", title: "Conducteur PL (H/F)", city: "Genas", contract: "CDI", date: "16/10/2026" };
    const offer = gestmaxOffer("x.gestmax.fr", "Kiloutou", listed, page(job))!;
    assert.equal(offer.location?.city, "Genas");
    assert.equal(offer.contractType, "permanent");
    assert.match(offer.description.content, /^<h3>Descriptif de l'offre<\/h3><p>Vous réalisez/);
    assert.doesNotMatch(offer.description.content, /Pied de page/);
    assert.equal(offer.publishedAt, "2026-10-16T00:00:00.000Z");
    assert.equal(gestmaxOffer("x.gestmax.fr", "Kiloutou", listed, page({ ...job, country: "Sénégal" })), null);
  });

  test("table lists: a row per offer; a date ahead is a closing date", () => {
    const row = (id: string, date: string) =>
      `<tr class="cell1 vacancy-id-${id}"><td class="col_vacancy_title"><a href="https://mbda.gestmax.fr/${id}/1/specialiste-f-h?backlink=search"> Spécialiste F/H </a></td><td class="col_vacancy_activation_date"><a href="#">${date}</a></td><td class="col_vac_localisation"><a href="#">Le Plessis Robinson (92)</a></td></tr>`;
    const list = gestmaxListPage(`<table>${row("20520", "19/10/2026")}${row("20521", "19/10/2999")}</table><a href="/search/index/page/35">35</a>`, "https://mbda.gestmax.fr");
    assert.deepEqual(list.offers[0], { id: "20520", url: "https://mbda.gestmax.fr/20520/1/specialiste-f-h", title: "Spécialiste F/H", date: "2026-10-19", contract: null, place: "Le Plessis Robinson (92)" });
    assert.equal(list.offers[1].date, null);
    assert.equal(list.lastPage, 35);
  });

  test("board ids from Common Crawl's addresses", () => {
    const board = (url: string) => gestmax.discovery!.slugFromUrl(new URL(url));
    assert.equal(board("https://kiloutou.gestmax.fr/16503/1/conducteur"), "kiloutou.gestmax.fr");
    assert.equal(board("https://www.gestmax.fr/"), null);
  });
});

describe("Gestmax runs", () => {
  test("every list page; pages read once; offers gone are closed", async () => {
    resetCrawler();
    resetGestmaxMemory();
    jobs = [
      { id: "16956", title: "Chef d'Atelier (H/F)", city: "Gennevilliers", contract: "CDI", date: "19/10/2026" },
      { id: "16503", title: "Conducteur Installateur PL (H/F)", city: "Genas", contract: "CDI", date: "16/10/2026" },
      { id: "16400", title: "Mécanicien (H/F)", city: "Lyon", contract: "CDD", date: "12/10/2026" },
    ];
    await prisma.companySource.create({ data: { ...TEST_BOARD(), status: "candidate" } });
    const check = await gestmax.check(slug);
    assert.deepEqual([check.companyName, check.jobCount, check.franceJobCount], ["Test Gestmax", 3, 3]);
    await prisma.companySource.update({ where: { ats_slug: TEST_BOARD() }, data: { status: "active", company: { create: { name: "Test Gestmax", normalizedName: "test gestmax" } } } });
    const connector = atsConnector(gestmax, { where: TEST_BOARD(), key: "test-gestmax" });
    const first = await runConnector(connector, { log: () => {} });
    assert.equal(first.counts.created, 3, "the second list page is read too");

    requests = [];
    await runConnector(connector, { log: () => {} });
    assert.equal(requests.filter((path) => /^\/\d+\//.test(path)).length, 0, "offer pages not read again");

    jobs = jobs.filter((job) => job.id !== "16400");
    await runConnector(connector, { log: () => {} });
    const closed = await prisma.offerSource.findUniqueOrThrow({ where: { source_externalId: { source: "gestmax", externalId: `${slug}:16400` } } });
    assert.ok(closed.closedAt);
  });
});
