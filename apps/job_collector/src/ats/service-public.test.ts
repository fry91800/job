import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import { backendConfig, prisma } from "@job/backend";
import { collectorConfig } from "../config";
import { resetCrawler } from "../crawler/fetcher";
import { runConnector } from "../runs/run-connector";
import { frenchDate, listedOffers, placeFrom, resetServicePublicMemory, SERVICE_PUBLIC_BOARD, servicePublic, servicePublicOffer } from "./adapters/service-public";
import { atsConnector } from "./connector";

// A local copy of Choisir le service public: listing pages (newest first) and offer pages
// in the site's markup. The board is the real one, "choisirleservicepublic.gouv.fr", in the
// test database; offer references start with "TEST-".

const LONG = "Vous piloterez la gestion administrative et financière des personnels du service. ".repeat(3);
const offerPage = (fields: { title: string; employer?: string; place?: string; remote?: string; pay?: string; deadline?: string; posted?: string }) => `<html><head>
<script type="application/ld+json">{"@context":"https://schema.org/","@type":"JobPosting","title":"${fields.title}","datePosted":"${(fields.posted ?? "10/10/2026").replace(/\//g, "\\/")}"}</script></head><body><main>
<h1>${fields.title}</h1>
<p class="number"><span aria-hidden="true">Réf.</span><span class="sr-only">Référence : </span> TEST-1</p>
<ul>
<li><span class="sr-only">Fonction publique : </span><span>Fonction publique de l'État</span></li>
<li><span class="sr-only">Employeur : </span> ${fields.employer ?? "Rectorat de Nantes"}</li>
<li><span class="sr-only">Localisation : </span> ${fields.place ?? "4 rue de la Houssinière 44322 NANTES CEDEX 3"}</li>
</ul>
<a href="https://recrutement.example.gouv.fr/offre/123">Postuler sur le site employeur</a>
<ul>
<li><span><strong>Nature de l’emploi</strong></span> Emploi ouvert uniquement aux contractuels</li>
<li><span><strong>Catégorie</strong></span> Catégorie A (cadre)</li>
<li data-module="salary"><div><span><strong>Rémunération</strong></span><span>Fourchette indicative pour les contractuels</span><span class="offer-result">${fields.pay ?? "La rémunération sera déterminée selon le profil"}</span></div></li>
<li><span><strong>Télétravail possible</strong></span> ${fields.remote ?? "Oui"}</li>
</ul>
<div class="col-left rte"><h2>Vos missions en quelques mots</h2><p>${LONG}</p><h2>Profil recherché</h2><p>Connaissance du statut général.</p></div>
<ul><li><section class="fr-accordion"><h3><button class="fr-accordion__btn">Descriptif du service</button></h3><div class="fr-collapse rte"><p>Le service compte huit agents.</p></div></section></li></ul>
<p>Date limite de candidature : ${fields.deadline ?? "30/11/2026"}</p>
</main></body></html>`;

// reference → page; the listing shows them in this order, 2 per page.
let offers: { reference: string; html: string; date: string }[] = [];
let requests: string[] = [];
let server: http.Server;
const TEST_BOARD = { ats: "choisirleservicepublic", slug: SERVICE_PUBLIC_BOARD };

function route(path: string): [number, string, Record<string, string>?] {
  const listing = /^\/nos-offres\/(?:page\/(\d+)\/)?$/.exec(path);
  if (listing) {
    const page = Number(listing[1] ?? 1);
    const cards = offers.slice((page - 1) * 2, page * 2).map((offer) => `<li class="fr-col-12 item"><div class="fr-card"><h3><a href="${collectorConfig.servicePublic.baseUrl}/offre-emploi/poste-reference-${offer.reference}/">Poste</a></h3><ul class="fr-card__desc"><li>En ligne depuis le ${offer.date}</li></ul></div></li>`);
    return [200, `<html><body><p><span class="number">${offers.length}</span> offres d'emploi trouvées</p><ul>${cards.join("")}</ul></body></html>`];
  }
  if (path === "/offre-depubliee/") return [200, "<html><body><h1>Cette offre n'est plus disponible</h1></body></html>"];
  const reference = /-reference-([^/]+)\/$/.exec(path)?.[1];
  const offer = offers.find((item) => item.reference === reference);
  if (offer?.html === "unpublished") return [302, "", { Location: "/offre-depubliee/" }];
  if (offer) return [200, offer.html];
  return [404, "not found"];
}

before(async () => {
  server = http.createServer((req, res) => {
    requests.push(req.url!);
    const [status, body, headers] = route(new URL(req.url!, "http://localhost").pathname);
    res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", ...headers }).end(body);
  });
  server.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  collectorConfig.servicePublic.baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  Object.assign(collectorConfig.crawler, { scheme: "http", minDelayMs: 0, allowedPrivateAddresses: ["127.0.0.1"] });
  collectorConfig.ats.detailRefreshDays = 1_000_000_000; // no weekly refresh during the tests
  backendConfig.geoapify.apiKey = undefined;
});

after(async () => {
  server.close();
  const where = { source: "choisirleservicepublic", externalId: { startsWith: `${SERVICE_PUBLIC_BOARD}:TEST-` } };
  const sources = await prisma.offerSource.findMany({ where, select: { offerId: true } });
  await prisma.offer.deleteMany({ where: { id: { in: sources.map((row) => row.offerId) } } });
  await prisma.rawOffer.deleteMany({ where });
  await prisma.companySource.deleteMany({ where: TEST_BOARD });
  await prisma.company.deleteMany({ where: { normalizedName: { in: ["rectorat de nantes", "mairie de lyon", "choisir le service public"] } } });
  await prisma.collectorRun.deleteMany({ where: { connector: "test-service-public" } });
  await prisma.$disconnect();
});

describe("Choisir le service public pages", () => {
  test("dates and places", () => {
    assert.equal(frenchDate("En ligne depuis le 22 août 2026"), "2026-08-22T00:00:00.000Z");
    assert.equal(frenchDate("1er octobre 2026"), "2026-10-01T00:00:00.000Z");
    assert.equal(frenchDate("30/10/2026"), "2026-10-30T00:00:00.000Z");
    assert.deepEqual(placeFrom("Route DE BADUEL 97306 CAYENNE CEDEX"), { city: "CAYENNE", postcode: "97306", countyCode: "973" });
    assert.deepEqual(placeFrom("9 boulevard du Palais 75004 Paris"), { city: "Paris", postcode: "75004", countyCode: "75" });
    assert.deepEqual(placeFrom("Campus Bordeaux Carreire - 146 rue Léo Saignat, Bordeaux", "Gironde (33)"), { city: "bordeaux", postcode: null, countyCode: "33" });
    assert.deepEqual(placeFrom("Préfecture", "Mayotte (976)"), { city: "Préfecture", postcode: null, countyCode: "976" });
  });

  test("listing cards", () => {
    const html = `<li class="fr-col-12 item"><a href="https://choisirleservicepublic.gouv.fr/offre-emploi/chef-hf-reference-MENJ-33-2026-48715/">Chef</a><ul><li>En ligne depuis le 17 octobre 2026</li></ul></li><li><a href="https://choisirleservicepublic.gouv.fr/aide/">Aide</a></li>`;
    assert.deepEqual(listedOffers(html), [{ reference: "MENJ-33-2026-48715", url: "https://choisirleservicepublic.gouv.fr/offre-emploi/chef-hf-reference-MENJ-33-2026-48715/", date: "2026-10-17T00:00:00.000Z" }]);
  });

  test("offer pages: employer, place, deadline, application link, facts then texts", () => {
    const offer = servicePublicOffer(offerPage({ title: "Chef de division (H/F)", pay: "2 400 € brut/mois" }), { url: "https://x.example/o", reference: "TEST-9" })!;
    assert.equal(offer.externalId, `${SERVICE_PUBLIC_BOARD}:TEST-9`);
    assert.deepEqual(offer.company, { name: "Rectorat de Nantes" });
    assert.deepEqual(offer.location, { raw: "4 rue de la Houssinière 44322 NANTES CEDEX 3", city: "NANTES", postcode: "44322", countyCode: "44", countryCode: "FR" });
    assert.equal(offer.applyUrl, "https://recrutement.example.gouv.fr/offre/123");
    assert.deepEqual([offer.publishedAt, offer.expiresAt], ["2026-10-10T00:00:00.000Z", "2026-11-30T00:00:00.000Z"]);
    assert.deepEqual([offer.remote, offer.salary?.min, offer.salary?.period], ["hybrid", 2400, "month"]);
    assert.match(offer.description.content, /^<ul><li><strong>Fonction publique<\/strong>[\s\S]*Vos missions[\s\S]*Profil recherché[\s\S]*<h3>Descriptif du service<\/h3>/);
    assert.equal(servicePublicOffer(offerPage({ title: "Poste" }), { url: "u", reference: "TEST-9" })!.salary, null, "no amount: no salary");
    const daily = servicePublicOffer(offerPage({ title: "Vacation", pay: "Forfait journalier brut de 105 euros € brut/an" }), { url: "u", reference: "TEST-9" })!;
    assert.deepEqual([daily.salary?.min, daily.salary?.period], [105, "day"], "the site's « brut/an » after every amount is ignored");
    const twoLines = servicePublicOffer(offerPage({ title: "Poste", employer: "Université de Bordeaux <br>L'université de Bordeaux" }), { url: "u", reference: "TEST-9" })!;
    assert.deepEqual(twoLines.company, { name: "Université de Bordeaux" });
  });
});

describe("Choisir le service public runs", () => {
  test("full pass first, then the newest pages only (nothing closed), weekly full pass closes", async () => {
    resetCrawler();
    resetServicePublicMemory();
    offers = [
      { reference: "TEST-1", html: offerPage({ title: "Chef de division (H/F)" }), date: "17 octobre 2026" },
      { reference: "TEST-2", html: offerPage({ title: "Juriste (H/F)", employer: "Mairie de Lyon", place: "1 place de la Comédie 69001 Lyon" }), date: "16 octobre 2026" },
      { reference: "TEST-3", html: "unpublished", date: "15 octobre 2026" },
      { reference: "TEST-4", html: offerPage({ title: "Infirmier (H/F)" }), date: "14 octobre 2026" },
    ];
    await prisma.companySource.create({ data: { ...TEST_BOARD, status: "active" } });
    const check = await servicePublic.check(SERVICE_PUBLIC_BOARD);
    assert.equal(check.jobCount, 4);

    const connector = atsConnector(servicePublic, { where: TEST_BOARD, key: "test-service-public" });
    const today = new Date().getUTCDay();
    collectorConfig.servicePublic.fullPassWeekday = (today + 1) % 7; // not today

    // Nothing known yet: the whole listing is read.
    const first = await runConnector(connector, { log: () => {} });
    // The same generic application link on every offer doesn't merge them.
    assert.equal(first.counts.created, 3, `the unpublished offer (redirected) is skipped: ${JSON.stringify(first.counts)}`);
    const lyon = await prisma.offerSource.findUniqueOrThrow({ where: { source_externalId: { source: "choisirleservicepublic", externalId: `${SERVICE_PUBLIC_BOARD}:TEST-2` } }, include: { offer: { include: { company: true } } } });
    assert.equal(lyon.offer.company?.name, "Mairie de Lyon");

    // A new offer on top; TEST-4 gone. Not the full-pass day: page 1 only, TEST-4 stays open.
    offers = [{ reference: "TEST-5", html: offerPage({ title: "Archiviste (H/F)" }), date: "18 octobre 2026" }, ...offers.filter((offer) => offer.reference !== "TEST-4")];
    requests = [];
    const second = await runConnector(connector, { log: () => {} });
    assert.equal(second.counts.created, 1);
    assert.ok(!requests.some((path) => path.includes("/page/3/")), requests.join(", "));
    const kept = await prisma.offerSource.findUniqueOrThrow({ where: { source_externalId: { source: "choisirleservicepublic", externalId: `${SERVICE_PUBLIC_BOARD}:TEST-4` } } });
    assert.equal(kept.closedAt, null, "a partial listing closes nothing");

    // The weekly full pass: TEST-4 is closed.
    collectorConfig.servicePublic.fullPassWeekday = today;
    await runConnector(connector, { log: () => {} });
    const closed = await prisma.offerSource.findUniqueOrThrow({ where: { source_externalId: { source: "choisirleservicepublic", externalId: `${SERVICE_PUBLIC_BOARD}:TEST-4` } } });
    assert.ok(closed.closedAt);
  });
});
