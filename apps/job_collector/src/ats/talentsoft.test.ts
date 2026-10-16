import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import { backendConfig, prisma } from "@job/backend";
import { collectorConfig } from "../config";
import { resetCrawler } from "../crawler/fetcher";
import { runConnector } from "../runs/run-connector";
import { companyFromSlug, listedOffers, resetTalentsoftMemory, talentsoft, talentsoftOffer, talentsoftPlace } from "./adapters/talentsoft";
import { atsConnector } from "./connector";

// A local Talentsoft career site: the paginated list of offers and offer pages, in the
// two page layouts seen on real sites (fields with ids, free-form). Its board is
// "127.0.0.1:<port>" in the test database.

const LONG = "Vous rejoindrez l'équipe et développerez les applications métier en Java et PostgreSQL. ".repeat(3);

type Fields = { title: string; area?: string; city?: string; contract?: string; pay?: string; deadline?: string };
const structured = (fields: Fields) => `<html><head>
<meta name="Description" content="Offre d'emploi Direction SI de '${fields.title}'. Lieu : ${fields.city ?? ""}. Date : 10/10/2026. Ref : 2026-1." /></head><body>
<h1 class="ts-offer-page__title">${fields.title}</h1>
<div class="ts-offer-page__content-details">
<div class="ts-offer-page__maj-date"><h3> Date de parution </h3> 10/10/2026 </div>
<h3> Intitulé du poste </h3><p id="fldjobdescription_jobtitle">${fields.title}</p>
<h3> Contrat </h3><p id="fldjobdescription_contract">${fields.contract ?? "CDI"}</p>
${fields.pay ? `<h3> Rémunération </h3><p id="fldjobdescription_salaryrange">${fields.pay}</p>` : ""}
<h3> Description de la mission </h3><div id="fldjobdescription_description1"><p>${LONG}</p></div>
<h3> Profil </h3><div id="fldjobdescription_description2"><p>Java, Spring, PostgreSQL</p></div>
${fields.area ? `<h3> Localisation du poste </h3><p id="fldlocation_location_geographicalareacollection">${fields.area}</p>` : ""}
${fields.city ? `<h3> Site </h3><p id="fldlocation_customcodetablevalue1">${fields.city}</p>` : ""}
${fields.deadline ? `<h3> Date limite de candidature </h3><p id="fldoffer_date1">${fields.deadline}</p>` : ""}
<h3> Politique diversité </h3><div id="fldoffer_longtext1"><p>Nous sommes engagés pour la diversité.</p></div>
</div></body></html>`;
const freeForm = (title: string, place: string) => `<html><head>
<meta name="Description" content="Offre d'emploi DAS de '${title}'. Lieu : ${place}. Date : 12/10/2026. Ref : 2026-9." /></head><body>
<h1 class="ts-offer-page__title"><span>${title}</span></h1>
<div class="ts-offer-page__content-details"><div style="font-weight: bold">Type de contrat</div><div>CDD</div><p>${LONG}</p></div></body></html>`;

// id → page; the list shows them 2 per page, with the date on each card.
let offers: Record<string, { html: string; date: string }> = {};
let requests: string[] = [];
let server: http.Server;
let slug: string;
const TEST_BOARD = () => ({ ats: "talentsoft", slug });

function route(url: URL): [number, string] {
  if (url.pathname === "/offre-de-emploi/liste-toutes-offres.aspx") {
    const ids = Object.keys(offers);
    const page = Number(url.searchParams.get("page") ?? 1);
    const cards = ids.slice((page - 1) * 2, page * 2).map((id) => `<li class="ts-offer-list-item"><h3><a href="/offre-de-emploi/emploi-offre-${id}_${id}.aspx">Offre ${id}</a></h3><ul><li>Réf. : 2026-${id}</li><li>${offers[id].date}</li></ul></li>`);
    return [200, `<html><body><p>Résultat de votre recherche (${ids.length} offres, page ${page})</p><ul>${cards.join("")}</ul><a href="/offre-de-emploi/liste-toutes-offres.aspx?page=${page + 1}&LCID=1036">${page + 1}</a></body></html>`];
  }
  const id = /_(\d+)\.aspx$/.exec(url.pathname)?.[1];
  if (id && offers[id]) return [200, offers[id].html];
  return [404, "not found"];
}

before(async () => {
  server = http.createServer((req, res) => {
    requests.push(req.url!);
    const [status, body] = route(new URL(req.url!, "http://localhost"));
    res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" }).end(body);
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
  const sources = await prisma.offerSource.findMany({ where: { source: "talentsoft", externalId: { startsWith: slug } }, select: { offerId: true } });
  await prisma.offer.deleteMany({ where: { id: { in: sources.map((row) => row.offerId) } } });
  await prisma.rawOffer.deleteMany({ where: { source: "talentsoft", externalId: { startsWith: slug } } });
  const board = await prisma.companySource.findUnique({ where: { ats_slug: TEST_BOARD() } });
  await prisma.companySource.deleteMany({ where: TEST_BOARD() });
  if (board?.companyId) await prisma.company.deleteMany({ where: { id: board.companyId } });
  await prisma.collectorRun.deleteMany({ where: { connector: "test-talentsoft" } });
  await prisma.$disconnect();
});

describe("Talentsoft pages", () => {
  test("places: the location field, else département, postcode or known city, else to look up", () => {
    assert.deepEqual(talentsoftPlace("France, Bourgogne-Franche-Comté, Saône et loire (71)", "Chalon-sur-Saône"), { france: true, city: "Chalon-sur-Saône", postcode: null, countyCode: "71" });
    assert.equal(talentsoftPlace("Belgique, Bruxelles", "Uccle").france, false);
    assert.deepEqual(talentsoftPlace("Europe, France, Ile-de-France, Val de Marne (94)", "Préfecture du Val-de-Marne SGCD94 21-29 avenue du Général de Gaulle"), { france: true, city: null, postcode: null, countyCode: "94" });
    assert.equal(talentsoftPlace("Europe, France, Pays de la Loire, NANTES", "Saint-Herblain").city, "Saint-Herblain");
    // The country left out by employers working only in France.
    assert.deepEqual(talentsoftPlace("Ile-de-France, Paris (75)", "17 place de la Bourse 75082 PARIS CEDEX 2"), { france: true, city: "paris", postcode: "75082", countyCode: "75" });
    assert.equal(talentsoftPlace("Occitanie", "ALBI").france, true);
    assert.equal(talentsoftPlace("Paris", null).france, true);
    assert.deepEqual([talentsoftPlace("Bagneux", null).france, talentsoftPlace("Bagneux", null).city], [null, "Bagneux"], "a town alone: looked up");
    assert.equal(talentsoftPlace("Occitanie", null).city, null, "a région is not a town");
    assert.equal(talentsoftPlace("Suisse, Bâle", "Bâle").france, false);
    assert.deepEqual(talentsoftPlace(null, "NANTES (44)"), { france: true, city: "nantes", postcode: null, countyCode: "44" });
    assert.equal(talentsoftPlace(null, "75016").france, true);
    assert.equal(talentsoftPlace(null, "Mérignac").france, null, "unknown: looked up");
    assert.equal(talentsoftPlace(null, null).france, false);
  });

  test("company names from the site address", () => {
    assert.equal(companyFromSlug("framatome-career.talent-soft.com"), "Framatome");
    assert.equal(companyFromSlug("recrutement-grenoble-em.talent-soft.com"), "Grenoble Em");
    assert.equal(companyFromSlug("dassault-aviation-cand.talent-soft.com"), "Dassault Aviation");
  });

  test("list cards: offer ids, addresses and dates", () => {
    const html = `<ul><li><a href="/offre-de-emploi/emploi-dev-java_21001.aspx">Dev</a><ul><li>17/10/2026</li></ul></li><li><a href="/offre-de-emploi/emploi-dev-java_21001.aspx">same</a></li><li><a href="/offre-de-emploi/liste-offres.aspx?page=2">2</a></li></ul>`;
    assert.deepEqual(listedOffers(html, "https://jobs.example"), [{ id: "21001", url: "https://jobs.example/offre-de-emploi/emploi-dev-java_21001.aspx", date: "2026-10-17T00:00:00.000Z" }]);
  });

  test("offer pages with fields: title, place, contract, pay, deadline, sections", async () => {
    const input = { url: "https://jobs.example/o", id: "1", slug: "acme-career.talent-soft.com", companyName: "Acme" };
    const offer = (await talentsoftOffer(structured({ title: "Développeur Java H/F", area: "France, Pays de la Loire, Loire-Atlantique (44)", city: "Nantes", contract: "Durée indéterminée", pay: "45 000 - 55 000 € brut annuel", deadline: "31/12/2026" }), input))!;
    assert.equal(offer.title, "Développeur Java H/F");
    assert.deepEqual(offer.location, { raw: "France, Pays de la Loire, Loire-Atlantique (44)", city: "nantes", postcode: null, countyCode: "44", countryCode: "FR" });
    assert.equal(offer.contractType, "permanent");
    assert.deepEqual(offer.salary, { min: 45000, max: 55000, currency: "EUR", period: "year", raw: "45 000 - 55 000 € brut annuel" });
    assert.equal(offer.publishedAt, "2026-10-10T00:00:00.000Z");
    assert.equal(offer.expiresAt, "2026-12-31T00:00:00.000Z");
    assert.match(offer.description.content, /^<h3>Description de la mission<\/h3>[\s\S]*<h3>Profil<\/h3>[\s\S]*<h3>Politique diversité<\/h3>/, "the job first, the employer's general texts after");

    assert.equal(await talentsoftOffer(structured({ title: "Éducateur", area: "Belgique, Bruxelles-Capitale", city: "Uccle" }), input), null);
    const monthly = (await talentsoftOffer(structured({ title: "Technicien", area: "France, Occitanie, Tarn (81)", pay: "2 100 € par mois" }), input))!;
    assert.deepEqual([monthly.salary?.min, monthly.salary?.period], [2100, "month"]);
  });

  test("free-form pages: title and place from the page, place looked up", async () => {
    const input = { url: "https://jobs.example/o", id: "2", slug: "acme-cand.talent-soft.com", companyName: "Acme" };
    const countries: Record<string, string> = { Mérignac: "FR", Uccle: "BE" };
    const lookUp = async (city: string) => countries[city] ?? null;
    const offer = (await talentsoftOffer(freeForm("CDD - Acheteur F/H", "Mérignac"), input, lookUp))!;
    assert.deepEqual([offer.title, offer.location?.city, offer.contractType], ["CDD - Acheteur F/H", "Mérignac", "fixed_term"]);
    assert.match(offer.description.content, /Type de contrat/);
    assert.equal(await talentsoftOffer(freeForm("Coordinateur", "Uccle"), input, lookUp), null);
  });
});

describe("Talentsoft runs", () => {
  test("check, collect from every list page, skip unchanged offers, close offers gone from the list", async () => {
    resetCrawler();
    resetTalentsoftMemory();
    offers = {
      "101": { html: structured({ title: "Développeur Java H/F", area: "France, Pays de la Loire, Loire-Atlantique (44)", city: "Nantes" }), date: "10/10/2026" },
      "102": { html: structured({ title: "Chef de projet SI", area: "France, Ile-de-France, Paris (75)", city: "Paris" }), date: "11/10/2026" },
      "103": { html: structured({ title: "Éducateur", area: "Belgique, Bruxelles-Capitale", city: "Uccle" }), date: "12/10/2026" },
    };
    await prisma.companySource.create({ data: { ...TEST_BOARD(), status: "candidate" } });

    const check = await talentsoft.check(slug);
    // The total from the list; the French share estimated on the first page (2 of 2).
    assert.deepEqual([check.jobCount, check.franceJobCount], [3, 3]);
    await prisma.companySource.update({ where: { ats_slug: TEST_BOARD() }, data: { status: "active" } });

    const connector = atsConnector(talentsoft, { where: TEST_BOARD(), key: "test-talentsoft" });
    requests = [];
    const first = await runConnector(connector, { log: () => {} });
    assert.equal(first.counts.created, 2, "the Belgian offer is skipped");
    assert.ok(requests.some((path) => path.includes("page=2")), "the second list page is read");
    const saved = await prisma.offerSource.findUniqueOrThrow({ where: { source_externalId: { source: "talentsoft", externalId: `${slug}:101` } }, include: { offer: true } });
    assert.deepEqual([saved.offer.title, saved.offer.contractType, saved.offer.source], ["Développeur Java H/F", "permanent", "talentsoft"]);

    // Same dates on the cards: offer pages aren't fetched again.
    requests = [];
    const second = await runConnector(connector, { log: () => {} });
    assert.equal(second.counts.received, 0);
    assert.ok(!requests.some((path) => path.includes("emploi-")), requests.join(", "));

    // Offer 102 leaves the list: closed.
    delete offers["102"];
    await runConnector(connector, { log: () => {} });
    const closed = await prisma.offerSource.findUniqueOrThrow({ where: { source_externalId: { source: "talentsoft", externalId: `${slug}:102` } } });
    assert.ok(closed.closedAt);
  });
});
