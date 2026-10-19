import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import { backendConfig, prisma } from "@job/backend";
import { collectorConfig } from "../config";
import { resetCrawler } from "../crawler/fetcher";
import { runConnector } from "../runs/run-connector";
import { avature, avatureOffer, resetAvatureMemory } from "./adapters/avature";
import { atsConnector } from "./connector";

// A local Avature site: its French sitemap and offer pages with Avature's field classes. Its
// board is "127.0.0.1:<port>/fr_FR".

const LONG = "Vous piloterez les projets de communication interne de la branche et animerez les événements managériaux. ".repeat(2);
type Job = { id: string; title: string; country: string; city: string; contract: string; lastmod: string };
let jobs: Job[] = [];
let requests: string[] = [];
let server: http.Server;
let slug: string;
const TEST_BOARD = () => ({ ats: "avature", slug });

const field = (label: string, value: string) =>
  `<div class="article__content__view__field">${label ? `<div class="article__content__view__field__label">${label}</div>` : ""}<div class="article__content__view__field__value">${value}</div></div>`;
const page = (job: Job) =>
  `<html><body><h2>${job.title}</h2>${field("Pays", job.country)}${field("Ville", job.city)}${field("Type de contrat", job.contract)}<h2>Activités</h2>${field("", `<p>${LONG}</p>`)}</body></html>`;

function route(path: string): [number, string, string] {
  if (path === "/robots.txt") return [200, "text/plain", "User-agent: *\nAllow: /*/careers\n"];
  if (path === "/fr_FR/careers/sitemap.xml") {
    const urls = jobs.map((job) => `<url><loc>http://${slug.split("/")[0]}/fr_FR/careers/JobDetail/${job.title.replace(/\W+/g, "-")}/${job.id}</loc><lastmod>${job.lastmod}</lastmod></url>`);
    return [200, "application/xml", `<urlset><url><loc>http://${slug.split("/")[0]}/fr_FR/careers/JobDetail</loc></url>${urls.join("")}</urlset>`];
  }
  const job = jobs.find((item) => path.endsWith(`/${item.id}`));
  if (job) return [200, "text/html", page(job)];
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
  slug = `127.0.0.1:${(server.address() as AddressInfo).port}/fr_FR`;
  Object.assign(collectorConfig.crawler, { scheme: "http", minDelayMs: 0, allowedPrivateAddresses: ["127.0.0.1"], maxOfferPagesPerRun: 1000 });
  collectorConfig.ats.pauseBetweenBoardsMs = 0;
  collectorConfig.ats.detailRefreshDays = 1_000_000_000;
  backendConfig.geoapify.apiKey = undefined;
});

after(async () => {
  server.close();
  const sources = await prisma.offerSource.findMany({ where: { source: "avature", externalId: { startsWith: slug } }, select: { offerId: true } });
  await prisma.offer.deleteMany({ where: { id: { in: sources.map((row) => row.offerId) } } });
  await prisma.rawOffer.deleteMany({ where: { source: "avature", externalId: { startsWith: slug } } });
  const board = await prisma.companySource.findUnique({ where: { ats_slug: TEST_BOARD() } });
  await prisma.companySource.deleteMany({ where: TEST_BOARD() });
  if (board?.companyId) await prisma.company.deleteMany({ where: { id: board.companyId } });
  await prisma.collectorRun.deleteMany({ where: { connector: "test-avature" } });
  await prisma.$disconnect();
});

describe("Avature pages", () => {
  test("the fields, the texts under their headings; France only", () => {
    const listed = { id: "85286", url: "https://x/fr_FR/careers/JobDetail/a/85286", date: "2026-09-22" };
    const offer = avatureOffer("x/fr_FR", "TotalEnergies", listed, page({ id: "85286", title: "Chargé de projets H/F", country: "France", city: "COURBEVOIE", contract: "Contrat de professionnalisation temps plein", lastmod: "" }))!;
    assert.equal(offer.location?.city, "Courbevoie");
    assert.equal(offer.contractType, "apprenticeship");
    assert.match(offer.description.content, /^<h3>Activités<\/h3><p>Vous piloterez/);
    assert.equal(offer.publishedAt, "2026-09-22T00:00:00.000Z");
    assert.equal(avatureOffer("x/fr_FR", "TotalEnergies", listed, page({ id: "1", title: "Engineer", country: "Angola", city: "LUANDA", contract: "Permanent", lastmod: "" })), null);
  });
});

describe("Avature addresses", () => {
  test("board ids: the French sections of avature.net sites", () => {
    const slug = (url: string) => avature.discovery!.slugFromUrl(new URL(url));
    assert.equal(slug("https://baloise.avature.net/fr_FR/careers/JobDetail/x/123"), "baloise.avature.net/fr_FR");
    assert.equal(slug("https://baloise.avature.net/en_US/careers/JobDetail/x/123"), null);
  });
});

describe("Avature runs", () => {
  test("pages read once; offers abroad remembered; offers gone are closed", async () => {
    resetCrawler();
    resetAvatureMemory();
    jobs = [
      { id: "85286", title: "Chargé de projets H/F", country: "France", city: "COURBEVOIE", contract: "CDI", lastmod: "2026-09-22" },
      { id: "85295", title: "Analyst FP&A", country: "Angola", city: "LUANDA", contract: "Permanent", lastmod: "2026-09-21" },
      { id: "85300", title: "Technicien de maintenance H/F", country: "France", city: "GONFREVILLE", contract: "CDD", lastmod: "2026-09-20" },
    ];
    await prisma.companySource.create({ data: { ...TEST_BOARD(), status: "active", company: { create: { name: "Test Avature", normalizedName: "test avature" } } } });
    const connector = atsConnector(avature, { where: TEST_BOARD(), key: "test-avature" });
    const first = await runConnector(connector, { log: () => {} });
    assert.equal(first.counts.created, 2);

    requests = [];
    await runConnector(connector, { log: () => {} });
    assert.equal(requests.filter((path) => path.includes("/JobDetail/")).length, 0, "nothing read again, not even the offer abroad");

    jobs = jobs.filter((job) => job.id !== "85300");
    await runConnector(connector, { log: () => {} });
    const closed = await prisma.offerSource.findUniqueOrThrow({ where: { source_externalId: { source: "avature", externalId: `${slug}:85300` } } });
    assert.ok(closed.closedAt);
  });
});
