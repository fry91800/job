import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import { backendConfig, prisma } from "@job/backend";
import { collectorConfig } from "../config";
import { resetCrawler } from "../crawler/fetcher";
import { runConnector } from "../runs/run-connector";
import { companyFromTitle, oracle } from "./adapters/oracle";
import { atsConnector } from "./connector";

// A local Oracle Recruiting Cloud site: its REST list (two offers a page) and details. Its
// board is "127.0.0.1:<port>/careers".

type Requisition = { Id: string; Title: string; PostedDate: string; PrimaryLocation: string; PrimaryLocationCountry: string };
let requisitions: Requisition[] = [];
let requests: string[] = [];
let server: http.Server;
let slug: string;
const TEST_BOARD = () => ({ ats: "oracle", slug });

function route(path: string, query: string): [number, string, string] {
  if (path.endsWith("/recruitingCEJobRequisitions") && decodeURIComponent(query).includes("facetsList=LOCATIONS")) {
    const france = requisitions.filter((item) => item.PrimaryLocationCountry === "FR").length;
    return [200, "application/json", JSON.stringify({ items: [{ TotalJobsCount: requisitions.length, locationsFacet: [{ Id: 300000000433029, Name: "France", TotalCount: france }, { Id: 1, Name: "Ile-de-France, France", TotalCount: france }] }] })];
  }
  if (path.endsWith("/recruitingCEJobRequisitions")) {
    const onlyFrance = decodeURIComponent(query).includes("selectedLocationsFacet=300000000433029");
    const listed = onlyFrance ? requisitions.filter((item) => item.PrimaryLocationCountry === "FR") : requisitions;
    const offset = Number(/offset=(\d+)/.exec(decodeURIComponent(query))?.[1] ?? 0);
    const page = listed.slice(offset, offset + 2).map((item) => ({ ...item, secondaryLocations: [] }));
    return [200, "application/vnd.oracle.adf.resourcecollection+json", JSON.stringify({ items: [{ TotalJobsCount: listed.length, requisitionList: page }] })];
  }
  if (path.endsWith("/recruitingCEJobRequisitionDetails")) {
    const id = /Id="(\d+)"/.exec(decodeURIComponent(query))?.[1];
    return [200, "application/json", JSON.stringify({ items: [{ Id: id, ExternalDescriptionStr: "<p>Rattaché(e) à la direction de la communication, vous piloterez les projets de marque.</p>", JobSchedule: "Temps plein" }] })];
  }
  return [404, "text/html", "not found"];
}

before(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url!, "http://localhost");
    requests.push(url.pathname);
    const [status, type, text] = route(url.pathname, url.search);
    res.writeHead(status, { "Content-Type": type }).end(text);
  });
  server.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  slug = `127.0.0.1:${(server.address() as AddressInfo).port}/careers`;
  Object.assign(collectorConfig.crawler, { scheme: "http", minDelayMs: 0, allowedPrivateAddresses: ["127.0.0.1"], maxOfferPagesPerRun: 1000 });
  collectorConfig.ats.pauseBetweenBoardsMs = 0;
  collectorConfig.ats.detailRefreshDays = 1_000_000_000;
  backendConfig.geoapify.apiKey = undefined;
});

after(async () => {
  server.close();
  const sources = await prisma.offerSource.findMany({ where: { source: "oracle", externalId: { startsWith: slug } }, select: { offerId: true } });
  await prisma.offer.deleteMany({ where: { id: { in: sources.map((row) => row.offerId) } } });
  await prisma.rawOffer.deleteMany({ where: { source: "oracle", externalId: { startsWith: slug } } });
  const board = await prisma.companySource.findUnique({ where: { ats_slug: TEST_BOARD() } });
  await prisma.companySource.deleteMany({ where: TEST_BOARD() });
  if (board?.companyId) await prisma.company.deleteMany({ where: { id: board.companyId } });
  await prisma.collectorRun.deleteMany({ where: { connector: "test-oracle" } });
  await prisma.$disconnect();
});

describe("Oracle Recruiting addresses and names", () => {
  test("board ids from Common Crawl's addresses; the company from the site's title", () => {
    const slug = (url: string) => oracle.discovery!.slugFromUrl(new URL(url));
    assert.equal(slug("https://eoct.fa.em2.oraclecloud.com/hcmUI/CandidateExperience/fr/sites/careers/job/6394"), "eoct.fa.em2.oraclecloud.com/careers");
    assert.equal(slug("https://eoct.fa.em2.oraclecloud.com/hcmRestApi/resources/latest/x"), null);
    assert.equal(companyFromTitle("Site Carri\\u00E8re Savencia"), "Savencia");
    assert.equal(companyFromTitle("Careers at Legrand"), "Legrand");
  });
});

describe("Oracle Recruiting runs", () => {
  test("France only, page after page; details read once; offers gone are closed", async () => {
    resetCrawler();
    requisitions = [
      { Id: "6394", Title: "CDD - Chef de Projet Communication (F/H)", PostedDate: "2026-10-16", PrimaryLocation: "VIROFLAY, 78-Yvelines, France", PrimaryLocationCountry: "FR" },
      { Id: "6390", Title: "Plant Manager", PostedDate: "2026-10-15", PrimaryLocation: "Madison, WI, United States", PrimaryLocationCountry: "US" },
      { Id: "6385", Title: "Technicien de maintenance (H/F)", PostedDate: "2026-10-14", PrimaryLocation: "LURE, 70-Haute-Saône, France", PrimaryLocationCountry: "FR" },
    ];
    await prisma.companySource.create({ data: { ...TEST_BOARD(), status: "candidate" } });
    const check = await oracle.check(slug);
    assert.deepEqual([check.jobCount, check.franceJobCount], [3, 2]);
    await prisma.companySource.update({ where: { ats_slug: TEST_BOARD() }, data: { status: "active", company: { create: { name: "Test Oracle", normalizedName: "test oracle" } } } });
    const connector = atsConnector(oracle, { where: TEST_BOARD(), key: "test-oracle" });
    const offer = (id: string) => prisma.offerSource.findUniqueOrThrow({ where: { source_externalId: { source: "oracle", externalId: `${slug}:${id}` } }, include: { offer: true } });

    const first = await runConnector(connector, { log: () => {} });
    assert.equal(first.counts.created, 2);
    const viroflay = (await offer("6394")).offer;
    assert.equal(viroflay.contractType, "fixed_term");
    assert.equal(viroflay.publishedAt?.toISOString(), "2026-10-16T00:00:00.000Z");
    assert.match(viroflay.description, /vous piloterez les projets de marque/);

    requests = [];
    await runConnector(connector, { log: () => {} });
    assert.equal(requests.filter((path) => path.endsWith("Details")).length, 0, "details not read again");

    requisitions = requisitions.filter((item) => item.Id !== "6385");
    await runConnector(connector, { log: () => {} });
    assert.ok((await offer("6385")).closedAt);
  });
});
