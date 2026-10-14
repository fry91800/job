// Integration tests for GET /api/offers. They run against the seeded test database
// (`npm test`).
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { OfferDetail, OfferSearchResponse, OfferSearchResult } from "@job/shared";
import { prisma, seedOfferId as offerId, startTestServer } from "../test/helpers";

let server: Awaited<ReturnType<typeof startTestServer>>;
let baseUrl: string;
const locationIds = new Map<string, number>();

async function search(query: Record<string, string | number>, session?: string) {
  const url = new URL("/api/offers", baseUrl);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
  const response = await fetch(url, { headers: session ? { Cookie: `session=${session}` } : {} });
  return { status: response.status, body: (await response.json()) as OfferSearchResponse & { error?: { code: string } } };
}

// Every page of a search, for assertions on the whole result set.
async function searchAll(query: Record<string, string | number>): Promise<OfferSearchResult[]> {
  const results: OfferSearchResult[] = [];
  for (let page = 1; ; page++) {
    const { body } = await search({ ...query, page });
    results.push(...body.results);
    if (page >= body.totalPages) return results;
  }
}

const location = (key: string) => {
  const id = locationIds.get(key);
  assert.ok(id, `seed location ${key} missing — run the tests with npm test`);
  return id;
};

before(async () => {
  const rows = await prisma.location.findMany({ where: { provider: "seed" }, select: { id: true, externalId: true } });
  for (const row of rows) locationIds.set(row.externalId!, row.id);
  server = await startTestServer();
  baseUrl = server.baseUrl;
});

after(() => server.close());

describe("GET /api/offers", () => {
  test("lists open public offers, 20 per page, most recent first", async () => {
    const { status, body } = await search({});
    assert.equal(status, 200);
    assert.equal(body.pageSize, 20);
    assert.equal(body.results.length, 20);
    assert.equal(body.total, 198);
    const dates = body.results.map((offer) => offer.publishedAt ?? "");
    assert.deepEqual(dates, [...dates].sort().reverse());
  });

  test("never returns closed or private offers", async () => {
    const ids = (await searchAll({})).map((offer) => offer.id);
    assert.ok(!ids.includes(offerId("edge-closed")));
    assert.ok(!ids.includes(offerId("edge-private-user")));
  });

  test("city search: radius, wider areas last, remote offers", async () => {
    const results = await searchAll({ locationId: location("city:brunoy"), radius: 10 });
    const byId = new Map(results.map((offer) => [offer.id, offer]));

    assert.equal(byId.get(offerId("edge-brunoy-fullstack"))?.locationMatch, "exact");
    assert.equal(byId.get(offerId("edge-region-idf"))?.locationMatch, "wider_area");
    assert.equal(byId.get(offerId("edge-county-essonne"))?.locationMatch, "wider_area");
    assert.equal(byId.get(offerId("edge-country-fr"))?.locationMatch, "wider_area");
    assert.equal(byId.get(offerId("edge-remote-bordeaux"))?.locationMatch, "remote");
    assert.equal(byId.get(offerId("edge-remote-no-location"))?.locationMatch, "remote");
    assert.ok(!byId.has(offerId("edge-remote-belgium")), "remote offers abroad are excluded");

    for (const offer of results.filter((item) => item.locationMatch === "exact")) {
      assert.ok(offer.distanceKm !== null && offer.distanceKm <= 10, `${offer.title} is within 10 km`);
    }
    const firstWider = results.findIndex((offer) => offer.locationMatch === "wider_area");
    assert.ok(results.slice(firstWider).every((offer) => offer.locationMatch === "wider_area"), "wider areas come last");
  });

  test("includeRemote=false keeps only located matches", async () => {
    const results = await searchAll({ locationId: location("city:brunoy"), radius: 10, includeRemote: "false" });
    assert.ok(results.every((offer) => offer.locationMatch !== "remote"));
    assert.ok(!results.some((offer) => offer.id === offerId("edge-remote-no-location")));
  });

  test("county search matches by code, without radius", async () => {
    const results = await searchAll({ locationId: location("county:91"), includeRemote: "false" });
    const exact = results.filter((offer) => offer.locationMatch === "exact");
    assert.ok(exact.length > 0);
    assert.ok(exact.every((offer) => offer.location?.countyName === "Essonne"));
    assert.ok(results.some((offer) => offer.id === offerId("edge-region-idf") && offer.locationMatch === "wider_area"));
  });

  test("keywords match titles without accents, companies and occupations", async () => {
    const noAccents = await searchAll({ q: "développeur fullstack" });
    assert.ok(noAccents.some((offer) => offer.id === offerId("edge-no-accents")));

    const company = await searchAll({ q: "Brunoy Digital" });
    assert.ok(company.some((offer) => offer.id === offerId("edge-brunoy-fullstack")));

    // "Data scientist" offers titled "Machine Learning Engineer" are found by occupation name.
    const occupation = await searchAll({ q: "scientifique" });
    assert.ok(occupation.length > 0);
  });

  test("a minimum salary only compares offers with the same currency and period", async () => {
    const results = await searchAll({ salaryMin: 50000 });
    assert.ok(!results.some((offer) => offer.id === offerId("edge-salary-usd")));
    assert.ok(results.some((offer) => offer.salary === null), "offers without salary are included");
    for (const offer of results.filter((item) => item.salary !== null)) {
      assert.equal(offer.salary!.currency, "EUR");
      assert.equal(offer.salary!.period, "year");
      assert.ok((offer.salary!.max ?? offer.salary!.min!) >= 50000);
    }

    const shownOnly = await searchAll({ salaryMin: 50000, salaryShownOnly: "true" });
    assert.ok(shownOnly.every((offer) => offer.salary !== null));
  });

  test("filters: contract, remote type, published within", async () => {
    const internships = await searchAll({ contractType: "internship" });
    assert.ok(internships.length > 0 && internships.every((offer) => offer.contractType === "internship"));

    const remoteOrHybrid = await searchAll({ remoteType: "remote,hybrid" });
    assert.ok(remoteOrHybrid.every((offer) => offer.remoteType === "remote" || offer.remoteType === "hybrid"));

    const lastMonth = await searchAll({ publishedWithin: "30d" });
    const ids = lastMonth.map((offer) => offer.id);
    assert.ok(!ids.includes(offerId("edge-old")));
    assert.ok(!ids.includes(offerId("edge-no-published-date")));
  });

  test("skills filter with relevance sort ranks by number of matched skills", async () => {
    const skills = await prisma.skill.findMany({ where: { externalId: { in: ["nodejs", "react", "postgresql"] } } });
    const skillIds = skills.map((skill) => skill.id);
    const { body } = await search({ skills: skillIds.join(","), sort: "relevance" });
    const matched = body.results.map((offer) => offer.skillIds.filter((id) => skillIds.includes(id)).length);
    assert.ok(matched.every((count) => count >= 1));
    assert.deepEqual(matched, [...matched].sort((a, b) => b - a));
  });

  test("returns skill and occupation ids, and the saved status for the session user", async () => {
    const anonymous = await searchAll({ q: "Brunoy Digital" });
    assert.equal(anonymous[0].saved, null);
    assert.ok(anonymous[0].skillIds.length > 0 && anonymous[0].occupationIds.length > 0);

    const { body } = await search({ q: "Brunoy Digital" }, "dev-session-demo");
    assert.deepEqual(body.results[0].saved, { status: "applied" });
  });

  test("rejects invalid parameters and unknown locations", async () => {
    const invalid = await search({ radius: 7 });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.error?.code, "invalid_request");

    const unknown = await search({ locationId: 999999 });
    assert.equal(unknown.status, 400);
    assert.equal(unknown.body.error?.code, "unknown_location");
  });
});

describe("GET /api/offers/:id", () => {
  test("returns the full offer with skill names in the requested language", async () => {
    const anonymous = server.client();
    const fr = await anonymous.get<OfferDetail>(`/api/offers/${offerId("edge-brunoy-fullstack")}`);
    assert.equal(fr.status, 200);
    assert.match(fr.body.description, /## Vos missions/);
    assert.equal(fr.body.location?.name, "Brunoy");
    assert.deepEqual(fr.body.skills.map((skill) => skill.name).sort(), ["Docker", "Express", "Node.js", "PostgreSQL", "React", "TypeScript"]);
    assert.ok(fr.body.occupations.some((occupation) => occupation.name === "Développeur full stack"));
    assert.equal(fr.body.saved, null);

    const en = await anonymous.get<OfferDetail>(`/api/offers/${offerId("edge-brunoy-fullstack")}?lang=en`);
    assert.ok(en.body.occupations.some((occupation) => occupation.name === "Full stack developer"));
  });

  test("closed offers stay viewable, with closedAt", async () => {
    const { status, body } = await server.client().get<OfferDetail>(`/api/offers/${offerId("edge-closed")}`);
    assert.equal(status, 200);
    assert.ok(body.closedAt);
  });

  test("private offers are visible to their creator only", async () => {
    const path = `/api/offers/${offerId("edge-private-user")}`;
    assert.equal((await server.client().get(path)).status, 404);
    assert.equal((await server.client("dev-session-alice").get(path)).status, 404);

    const demo = await server.client("dev-session-demo").get<OfferDetail>(path);
    assert.equal(demo.status, 200);
    assert.equal(demo.body.isOwn, true);
    assert.equal(demo.body.saved?.status, "saved");
  });

  test("includes the user's saved entry", async () => {
    const { body } = await server.client("dev-session-demo").get<OfferDetail>(`/api/offers/${offerId("edge-brunoy-fullstack")}`);
    assert.equal(body.saved?.status, "applied");
    assert.equal(body.saved?.notes, "Candidature envoyée via le site.");
    assert.deepEqual(body.generatedResumes, []);
  });

  test("unknown or malformed ids return 404", async () => {
    assert.equal((await server.client().get(`/api/offers/${offerId("does-not-exist")}`)).status, 404);
    assert.equal((await server.client().get("/api/offers/not-a-uuid")).status, 404);
  });
});
