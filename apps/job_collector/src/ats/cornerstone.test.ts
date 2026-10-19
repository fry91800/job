import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import { backendConfig, prisma } from "@job/backend";
import { collectorConfig } from "../config";
import { resetCrawler } from "../crawler/fetcher";
import { runConnector } from "../runs/run-connector";
import { cornerstone } from "./adapters/cornerstone";
import { atsConnector } from "./connector";

// A local Cornerstone site: the career page giving a token and the API's address, the search
// API (checking the token; two offers a page) and offer pages with JobPosting. Its board is
// "127.0.0.1:<port>/2".

const TOKEN = "eyJhbGciOiJIUzI1NiJ9.public-career-site-token.signature";
const LONG = "Vous piloterez la performance financière du site et accompagnerez les équipes opérationnelles. ".repeat(3);
type Requisition = { requisitionId: number; displayJobTitle: string; postingEffectiveDate: string; locations: { city: string; country: string }[] };
let requisitions: Requisition[] = [];
let requests: { method: string; path: string; authorization?: string }[] = [];
let server: http.Server;
let slug: string;
let base: string;
const TEST_BOARD = () => ({ ats: "cornerstone", slug });

function route(method: string, path: string, body: string, authorization: string | undefined): [number, string, string] {
  if (path === "/robots.txt") return [200, "text/plain", "User-agent: *\nCrawl-delay: 0\n"];
  if (path === "/ux/ats/careersite/2/home") return [200, "text/html", `<html><script>var csod = {"token":"${TOKEN}","cloud":"${base}/"};</script></html>`];
  if (method === "POST" && path === "/rec-job-search/external/jobs") {
    if (authorization !== `Bearer ${TOKEN}`) return [401, "application/json", "{}"];
    const page = (JSON.parse(body) as { pageNumber: number }).pageNumber;
    const items = requisitions.slice((page - 1) * 2, page * 2).map((item) => ({ ...item, externalDescription: "Résumé court." }));
    return [200, "application/json", JSON.stringify({ data: { totalCount: requisitions.length, requisitions: items } })];
  }
  const id = /^\/ux\/ats\/careersite\/2\/home\/requisition\/(\d+)$/.exec(path)?.[1];
  const requisition = requisitions.find((item) => String(item.requisitionId) === id);
  if (requisition) {
    const posting = { "@context": "http://schema.org", "@type": "JobPosting", title: requisition.displayJobTitle, description: `<p>${LONG}</p>`, employmentType: "FULL_TIME" };
    return [200, "text/html", `<html><script type="application/ld+json">${JSON.stringify(posting)}</script></html>`];
  }
  return [404, "text/html", "not found"];
}

before(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const path = new URL(req.url!, "http://localhost").pathname;
      requests.push({ method: req.method!, path, authorization: req.headers.authorization });
      const [status, type, text] = route(req.method!, path, body, req.headers.authorization);
      res.writeHead(status, { "Content-Type": type }).end(text);
    });
  });
  server.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const host = `127.0.0.1:${(server.address() as AddressInfo).port}`;
  base = `http://${host}`;
  slug = `${host}/2`;
  Object.assign(collectorConfig.crawler, { scheme: "http", minDelayMs: 0, allowedPrivateAddresses: ["127.0.0.1"], maxOfferPagesPerRun: 1000 });
  collectorConfig.ats.pauseBetweenBoardsMs = 0;
  collectorConfig.ats.detailRefreshDays = 1_000_000_000;
  backendConfig.geoapify.apiKey = undefined;
});

after(async () => {
  server.close();
  const sources = await prisma.offerSource.findMany({ where: { source: "cornerstone", externalId: { startsWith: slug } }, select: { offerId: true } });
  await prisma.offer.deleteMany({ where: { id: { in: sources.map((row) => row.offerId) } } });
  await prisma.rawOffer.deleteMany({ where: { source: "cornerstone", externalId: { startsWith: slug } } });
  const board = await prisma.companySource.findUnique({ where: { ats_slug: TEST_BOARD() } });
  await prisma.companySource.deleteMany({ where: TEST_BOARD() });
  if (board?.companyId) await prisma.company.deleteMany({ where: { id: board.companyId } });
  await prisma.collectorRun.deleteMany({ where: { connector: "test-cornerstone" } });
  await prisma.$disconnect();
});

describe("Cornerstone addresses", () => {
  test("board ids from Common Crawl's addresses: tenant and career site", () => {
    const slug = (url: string) => cornerstone.discovery!.slugFromUrl(new URL(url));
    assert.equal(slug("https://hris-suez.csod.com/ux/ats/careersite/10/home/requisition/123?c=hris-suez"), "hris-suez.csod.com/10");
    assert.equal(slug("https://groupeavril.csod.com/ux/ats/careersite/2/home"), "groupeavril.csod.com/2");
    assert.equal(slug("https://www.csod.com/fr/"), null);
  });
});

describe("Cornerstone runs", () => {
  test("the page's token for the search; France only; full description from the offer page; offers gone are closed", async () => {
    resetCrawler();
    requisitions = [
      { requisitionId: 7097, displayJobTitle: "Responsable contrôle de gestion - CDI", postingEffectiveDate: "16/10/2026", locations: [{ city: "BRUZ", country: "FR" }] },
      { requisitionId: 7090, displayJobTitle: "Plant Controller", postingEffectiveDate: "15/10/2026", locations: [{ city: "TORONTO", country: "CA" }] },
      { requisitionId: 7085, displayJobTitle: "Opérateur de fabrication (H/F)", postingEffectiveDate: "14/10/2026", locations: [{ city: "SETE", country: "FR" }] },
    ];
    await prisma.companySource.create({ data: { ...TEST_BOARD(), status: "candidate" } });
    const check = await cornerstone.check(slug);
    assert.deepEqual([check.jobCount, check.franceJobCount], [3, 2]);
    assert.ok(requests.some((request) => request.method === "POST" && request.authorization === `Bearer ${TOKEN}`), "the search carries the page's token");
    await prisma.companySource.update({ where: { ats_slug: TEST_BOARD() }, data: { status: "active", company: { create: { name: "Test Cornerstone", normalizedName: "test cornerstone" } } } });
    const connector = atsConnector(cornerstone, { where: TEST_BOARD(), key: "test-cornerstone" });
    const offer = (id: string) => prisma.offerSource.findUniqueOrThrow({ where: { source_externalId: { source: "cornerstone", externalId: `${slug}:${id}` } }, include: { offer: true } });

    const first = await runConnector(connector, { log: () => {} });
    assert.equal(first.counts.created, 2);
    const bruz = (await offer("7097")).offer;
    assert.equal(bruz.publishedAt?.toISOString(), "2026-10-16T00:00:00.000Z");
    assert.equal(bruz.contractType, "permanent");
    assert.match(bruz.description, /^Vous piloterez la performance/);

    requests = [];
    await runConnector(connector, { log: () => {} });
    assert.equal(requests.filter((request) => request.path.includes("/requisition/")).length, 0, "offer pages not read again");

    requisitions = requisitions.filter((item) => item.requisitionId !== 7085);
    await runConnector(connector, { log: () => {} });
    assert.ok((await offer("7085")).closedAt);
  });
});
