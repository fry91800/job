import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { OfferDetail, OfferSearchResponse, SavedOfferListResponse } from "@job/shared";
import { config } from "../config";
import { prisma, seedOfferId, startTestServer, TestClient, TEST_PASSWORD, uniqueEmail } from "../test/helpers";

let server: Awaited<ReturnType<typeof startTestServer>>;

before(async () => {
  server = await startTestServer();
});
after(async () => {
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
  test("pasted text: first line is the title, line breaks are kept", async () => {
    const client = server.client();
    const text = "\n  [test] Développeur Vue.js  \nChez Exemple\n\n- missions\n- profil";
    const { status, body } = await client.post("/api/user-offers/extract", { text });
    assert.equal(status, 200);
    assert.equal(body.draft.title, "[test] Développeur Vue.js");
    assert.equal(body.draft.description, "Chez Exemple\n\n- missions\n- profil");
    assert.equal(body.draft.url, null);
    assert.ok(client.session, "extraction creates the guest");
  });

  test("URL: a new page gives the placeholder draft with the normalized URL", async () => {
    const { body } = await server.client().post("/api/user-offers/extract", { url: "HTTPS://Test.Example/new-offer?utm_source=x" });
    assert.equal(body.draft.url, "https://test.example/new-offer");
    assert.ok(body.draft.title);
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
