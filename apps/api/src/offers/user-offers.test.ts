import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import type { OfferDetail, OfferSearchResponse, SavedOfferListResponse } from "@job/shared";
import { config } from "../config";
import { sampleExtractedOffer } from "../test/fixtures/sample-offer";
import { prisma, seedOfferId, startTestServer, TestClient, TEST_PASSWORD, uniqueEmail } from "../test/helpers";

let server: Awaited<ReturnType<typeof startTestServer>>;
let site: http.Server;
let siteUrl: string;

// A job site serving one offer page, with navigation, scripts and JobPosting data.
const OFFER_PAGE = `<html><head><title>Développeur React H/F - Exemple SA</title>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"JobPosting","title":"Développeur React H/F","hiringOrganization":{"name":"Exemple SA"}}</script>
<script>trackVisitor("secret-tracking-code")</script></head>
<body><nav>Accueil · Offres · Connexion</nav>
<main><h1>Développeur React H/F</h1><p>Exemple SA recrute un développeur <strong>React</strong> à Brunoy.</p>
<h2>Missions</h2><ul><li>Développer en React et Node.js</li><li>Revoir le code</li></ul>
<p>${"Description détaillée du poste. ".repeat(12)}</p></main>
<footer>Mentions légales</footer></body></html>`;

before(async () => {
  server = await startTestServer();
  site = http.createServer((req, res) => {
    if (req.url?.startsWith("/offer")) res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(OFFER_PAGE);
    else if (req.url === "/login") res.writeHead(403).end();
    else res.writeHead(404).end();
  });
  site.listen(0, "127.0.0.1");
  await new Promise((resolve) => site.once("listening", resolve));
  siteUrl = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;
  config.fetch.allowedPrivateAddresses = ["127.0.0.1"];
});
after(async () => {
  config.fetch.allowedPrivateAddresses = [];
  site.closeAllConnections();
  site.close();
  // User-added offers are never deleted by the app; remove the ones these tests created
  // (saved entries first: they reference the offers).
  try {
    const where = { source: "user", OR: [{ url: { startsWith: "https://test.example/" } }, { title: { startsWith: "[test]" } }] };
    await prisma.savedOffer.deleteMany({ where: { offer: where } });
    await prisma.offer.deleteMany({ where });
  } finally {
    await server.close();
  }
});

// French UI: offer details name skills in the user's language.
async function registered(): Promise<TestClient> {
  const client = server.client();
  await client.post("/api/auth/signup", { email: uniqueEmail(), password: TEST_PASSWORD, uiLanguage: "fr" });
  return client;
}

let counter = 0;
const testUrl = () => `https://test.example/offers/${Date.now()}-${counter++}`;
const draft = (fields: object = {}) => ({
  title: "[test] Développeur full stack",
  description: "Nous cherchons une personne maîtrisant React, Node.js et PostgreSQL.\nTélétravail possible.",
  language: "fr",
  ...fields,
});

describe("user-added offers (O5)", () => {
  test("pasted text: the AI extracts the fields, the text stays the description", async () => {
    const client = server.client();
    const text = "  [test] Développeur React  \nChez Exemple SA, à Brunoy.\n\n- React\n- Node.js\nSalaire : 45-55 k€";
    const { status, body } = await client.post("/api/user-offers/extract", { text });
    assert.equal(status, 200);
    assert.equal(body.draft.title, sampleExtractedOffer.title);
    assert.equal(body.draft.description, text.trim(), "pasted line breaks kept");
    assert.equal(body.draft.url, null);
    assert.equal(body.draft.salaryCurrency, "EUR");
    const brunoy = await prisma.location.findFirstOrThrow({ where: { name: "Brunoy" } });
    assert.equal(body.draft.locationId, brunoy.id, "location matched to the locations table");
    assert.equal(body.location?.name, "Brunoy", "the place's name, for display");
    assert.ok(client.session, "extraction creates the guest");

    const request = server.ai.requests.at(-1)!;
    assert.equal(request.task, "extract-offer");
    assert.ok("text" in request.parts[0] && request.parts[0].text.includes("<offer>"));
    assert.ok(!("description" in (request.jsonSchema as any).properties), "no description asked for pasted text");
    // Gemini rejects a schema that requires a property it doesn't define.
    assert.ok(!(request.jsonSchema as any).required.includes("description"));
  });

  test("URL: the page is fetched and reduced to its content for the AI", async () => {
    const { status, body } = await server.client().post("/api/user-offers/extract", { url: `${siteUrl}/offer?utm_source=mail` });
    assert.equal(status, 200);
    assert.equal(body.draft.url, `${siteUrl}/offer`, "normalized URL kept");
    assert.equal(body.draft.description, sampleExtractedOffer.description);

    const content = (server.ai.requests.at(-1)!.parts[0] as { text: string }).text;
    assert.match(content, /<page title="Développeur React H\/F - Exemple SA">/);
    assert.match(content, /## Missions/);
    assert.match(content, /- Développer en React et Node.js/);
    assert.match(content, /\*\*React\*\*/);
    assert.match(content, /<structured-data>\n\[\{"@context":"https:\/\/schema.org","@type":"JobPosting"/);
    assert.doesNotMatch(content, /secret-tracking-code|Mentions légales|Connexion/, "scripts, navigation and footer removed");
  });

  test("URL: unreadable pages and non-offers ask to paste the text", async () => {
    const forbidden = await server.client().post("/api/user-offers/extract", { url: `${siteUrl}/login` });
    assert.equal(forbidden.status, 422);
    assert.equal(forbidden.body.error.code, "page_unavailable");

    await server.ai.with("extract-offer", () => ({ ...sampleExtractedOffer, isJobOffer: false }), async () => {
      const notOffer = await server.client().post("/api/user-offers/extract", { url: `${siteUrl}/offer` });
      assert.equal(notOffer.body.error.code, "not_a_job_offer");
    });
  });

  test("URL: private network addresses are never fetched", async () => {
    const { status, body } = await server.client().post("/api/user-offers/extract", { url: "http://169.254.169.254/latest/meta-data" });
    assert.equal(status, 422);
    assert.equal(body.error.code, "blocked_address");
  });

  test("inconsistent salaries are fixed or dropped", async () => {
    const text = "[test] Une offre avec un salaire étrange et assez de texte.";
    const swapped = { ...sampleExtractedOffer, salary: { min: 60000, max: 50000, currency: "EUR", period: "year" } };
    await server.ai.with("extract-offer", () => swapped, async () => {
      const { body } = await server.client().post("/api/user-offers/extract", { text });
      assert.deepEqual([body.draft.salaryMin, body.draft.salaryMax], [50000, 60000]);
    });
    const noPeriod = { ...sampleExtractedOffer, salary: { min: 50000, max: null, currency: "EUR", period: null } };
    await server.ai.with("extract-offer", () => noPeriod, async () => {
      const { body } = await server.client().post("/api/user-offers/extract", { text });
      assert.equal(body.draft.salaryMin, null);
    });
  });

  test("URL: a known page reuses the existing offer and saves it", async () => {
    const client = server.client();
    const { body } = await client.post("/api/user-offers/extract", {
      url: "https://JOBS.example.com/offers/edge-brunoy-fullstack?utm_campaign=mail",
    });
    assert.deepEqual(body, { existingOfferId: seedOfferId("edge-brunoy-fullstack") });
    const saved = (await client.get<SavedOfferListResponse>("/api/saved-offers")).body.results;
    assert.deepEqual(saved.map((item) => item.offer.id), [seedOfferId("edge-brunoy-fullstack")]);
  });

  test("invalid input is rejected", async () => {
    assert.equal((await server.client().post("/api/user-offers/extract", { url: "javascript:alert(1)" })).status, 400);
    assert.equal((await server.client().post("/api/user-offers/extract", { text: "too short" })).status, 400);
    assert.equal((await server.client().post("/api/user-offers/extract", {})).status, 400);
  });

  test("create: private, saved, linked to the catalogue, absent from search", async () => {
    const client = await registered();
    const url = testUrl();
    const { status, body } = await client.post<OfferDetail>("/api/user-offers", draft({ url }));
    assert.equal(status, 201);
    assert.equal(body.isPublic, false);
    assert.equal(body.isOwn, true);
    assert.equal(body.url, url);
    assert.equal(body.saved?.status, "saved");
    assert.deepEqual(body.skills.map((skill) => skill.name).sort(), ["Node.js", "PostgreSQL", "React"]);
    assert.deepEqual(body.occupations.map((occupation) => occupation.name), ["Développeur full stack"]);

    const row = await prisma.offer.findUniqueOrThrow({ where: { id: body.id } });
    assert.equal(row.source, "user");
    const search = (await client.get<OfferSearchResponse>(`/api/offers?q=${encodeURIComponent("[test]")}`)).body;
    assert.ok(!search.results.some((offer) => offer.id === body.id));
    assert.equal((await server.client().get(`/api/offers/${body.id}`)).status, 404, "private");
  });

  test("another user adding the same URL gets the existing offer", async () => {
    const owner = await registered();
    const url = testUrl();
    const created = (await owner.post<OfferDetail>("/api/user-offers", draft({ url }))).body;

    const other = await registered();
    const conflict = await other.post("/api/user-offers", draft({ url }));
    assert.equal(conflict.status, 409);
    assert.deepEqual(conflict.body.error.details, { existingOfferId: created.id });

    const extracted = await other.post("/api/user-offers/extract", { url });
    assert.deepEqual(extracted.body, { existingOfferId: created.id });
    const detail = await other.get<OfferDetail>(`/api/offers/${created.id}`);
    assert.equal(detail.status, 200, "visible once saved");
    assert.equal(detail.body.isOwn, false);
  });

  test("validation of the reviewed fields", async () => {
    const client = await registered();
    const post = (fields: object) => client.post("/api/user-offers", draft(fields));
    assert.equal((await post({ salaryMin: 50000, salaryMax: 40000, salaryCurrency: "EUR", salaryPeriod: "year" })).status, 400);
    assert.equal((await post({ salaryMin: 50000 })).status, 400, "a salary needs a currency and a period");
    assert.equal((await post({ locationId: 999999 })).body.error.code, "unknown_location");
    assert.equal((await post({ title: "" })).status, 400);
  });

  test("the creator can edit while the offer is private", async () => {
    const owner = await registered();
    const created = (await owner.post<OfferDetail>("/api/user-offers", draft())).body;

    const brunoy = await prisma.location.findFirstOrThrow({ where: { name: "Brunoy" } });
    const edited = await owner.put<OfferDetail>(
      `/api/user-offers/${created.id}`,
      draft({ title: "[test] Data analyst", description: "SQL et Power BI", locationId: brunoy.id, salaryMin: 40000, salaryCurrency: "EUR", salaryPeriod: "year" }),
    );
    assert.equal(edited.status, 200);
    assert.equal(edited.body.location?.name, "Brunoy");
    assert.deepEqual(edited.body.skills.map((skill) => skill.name).sort(), ["Power BI", "SQL"]);
    assert.deepEqual(edited.body.occupations.map((occupation) => occupation.name), ["Data analyst"]);

    const other = await registered();
    assert.equal((await other.put(`/api/user-offers/${created.id}`, draft())).status, 404);

    await prisma.offer.update({ where: { id: created.id }, data: { isPublic: true } });
    const readOnly = await owner.put(`/api/user-offers/${created.id}`, draft());
    assert.equal(readOnly.status, 403);
    assert.equal(readOnly.body.error.code, "offer_read_only");
  });

  test("guests can add at most the configured number of offers", async () => {
    const client = server.client();
    for (let i = 0; i < config.limits.userOffers.guestTotal; i++) {
      assert.equal((await client.post("/api/user-offers", draft())).status, 201);
    }
    assert.equal((await client.post("/api/user-offers", draft())).status, 429);
    assert.equal((await client.post("/api/user-offers/extract", { text: "[test] Un titre\nUne description assez longue." })).status, 429);
  });
});
