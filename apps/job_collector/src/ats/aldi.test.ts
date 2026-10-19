import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import { backendConfig, prisma } from "@job/backend";
import { collectorConfig } from "../config";
import { resetCrawler } from "../crawler/fetcher";
import { runConnector } from "../runs/run-connector";
import { aldi, aldiDescription, nextApiData } from "./adapters/aldi";
import { atsConnector } from "./connector";

// A local copy of Aldi's career pages: the search page with every offer in its Next.js data,
// offer pages with their texts. Its board is "127.0.0.1:<port>".

type Job = { postingId: string; title: string; slugTitle: string; onlineFrom: string; onlineUntil: string; careerLevelName: string; locations: { zipCode: string; city: string; country: string }[] };
let jobs: Job[] = [];
let requests: string[] = [];
let server: http.Server;
let slug: string;
const TEST_BOARD = () => ({ ats: "aldi", slug });

const nextPage = (apiData: unknown[]) => `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { apiData: JSON.stringify(apiData) } } })}</script></body></html>`;

function route(path: string): [number, string, string] {
  if (path === "/robots.txt") return [200, "text/plain", "User-agent: *\nDisallow: /can/\n"];
  if (path === "/carriere/recherche-offres.html") return [200, "text/html", nextPage([["JOB_HR_GET_ALL", { req: { locale: "fr-FR" }, res: { total: jobs.length, results: jobs } }]])];
  const job = jobs.find((item) => path === `/carriere/detail/${item.slugTitle}-${item.postingId}.html`);
  if (job) {
    const detail = { ...job, jobDutiesLabel: "Vos tâches", jobDuties: "Accueil des clients.\nMise en rayon.", jobRequirementsLabel: "Vos atouts", jobRequirements: "Dynamisme & sens du service", aboutUsLabel: "A propos de nous", aboutUs: "ALDI, grand groupe de distribution alimentaire européen." };
    return [200, "text/html", nextPage([["JOB_HR_GET", { req: { jobId: job.postingId }, res: detail }]])];
  }
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
  Object.assign(collectorConfig.crawler, { scheme: "http", minDelayMs: 0, allowedPrivateAddresses: ["127.0.0.1"], maxOfferPagesPerRun: 1000 });
  collectorConfig.ats.pauseBetweenBoardsMs = 0;
  collectorConfig.ats.detailRefreshDays = 1_000_000_000;
  backendConfig.geoapify.apiKey = undefined;
});

after(async () => {
  server.close();
  const sources = await prisma.offerSource.findMany({ where: { source: "aldi", externalId: { startsWith: slug } }, select: { offerId: true } });
  await prisma.offer.deleteMany({ where: { id: { in: sources.map((row) => row.offerId) } } });
  await prisma.rawOffer.deleteMany({ where: { source: "aldi", externalId: { startsWith: slug } } });
  const board = await prisma.companySource.findUnique({ where: { ats_slug: TEST_BOARD() } });
  await prisma.companySource.deleteMany({ where: TEST_BOARD() });
  if (board?.companyId) await prisma.company.deleteMany({ where: { id: board.companyId } });
  await prisma.collectorRun.deleteMany({ where: { connector: "test-aldi" } });
  await prisma.$disconnect();
});

describe("Aldi pages", () => {
  test("the page's API answers; the texts under their labels, escaped", () => {
    assert.deepEqual(nextApiData(nextPage([["JOB_HR_GET", { res: { title: "x" } }]])).get("JOB_HR_GET"), { title: "x" });
    assert.equal(nextApiData("<html></html>").size, 0);
    assert.equal(aldiDescription({ jobDutiesLabel: "Vos tâches", jobDuties: "A & B\nC" }), "<h3>Vos tâches</h3><p>A &amp; B<br>C</p>");
  });
});

describe("Aldi runs", () => {
  test("every offer from the search page, its texts from its page once; offers gone are closed", async () => {
    resetCrawler();
    jobs = [
      { postingId: "273044", title: "Employé Commercial (H/F)", slugTitle: "employe-commercial-h-f-gueugnon", onlineFrom: "2026-05-21", onlineUntil: "2026-11-26", careerLevelName: "Contrat à durée indéterminée", locations: [{ zipCode: "71130", city: "Gueugnon", country: "France" }] },
      { postingId: "275727", title: "Assistant Magasin (H/F)", slugTitle: "assistant-magasin-h-f-nogent", onlineFrom: "2026-06-02", onlineUntil: "2026-12-02", careerLevelName: "Contrat à durée déterminée", locations: [{ zipCode: "52800", city: "Nogent", country: "France" }] },
    ];
    await prisma.companySource.create({ data: { ...TEST_BOARD(), status: "candidate" } });
    assert.equal((await aldi.check(slug)).franceJobCount, 2);
    await prisma.companySource.update({ where: { ats_slug: TEST_BOARD() }, data: { status: "active", company: { create: { name: "Test Aldi", normalizedName: "test aldi" } } } });
    const connector = atsConnector(aldi, { where: TEST_BOARD(), key: "test-aldi" });
    const offer = (id: string) => prisma.offerSource.findUniqueOrThrow({ where: { source_externalId: { source: "aldi", externalId: `${slug}:${id}` } }, include: { offer: true } });

    const first = await runConnector(connector, { log: () => {} });
    assert.equal(first.counts.created, 2);
    const gueugnon = (await offer("273044")).offer;
    assert.equal(gueugnon.contractType, "permanent");
    assert.equal((await offer("275727")).offer.contractType, "fixed_term");
    assert.equal(gueugnon.publishedAt?.toISOString(), "2026-05-21T00:00:00.000Z");
    assert.match(gueugnon.description, /Vos tâches[\s\S]*Accueil des clients/);

    requests = [];
    await runConnector(connector, { log: () => {} });
    assert.equal(requests.filter((path) => path.startsWith("/carriere/detail/")).length, 0, "unchanged offers are not read again");

    jobs = jobs.slice(0, 1);
    await runConnector(connector, { log: () => {} });
    assert.ok((await offer("275727")).closedAt);
  });
});
