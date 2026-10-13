import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import type { LocationAutocompleteResponse, OfferSearchResponse } from "@job/shared";
import { config } from "../config";
import { prisma, seedOfferId, startTestServer } from "../test/helpers";
import { clearGeoapifyCache, departementCode, matchLocation, toGeoPlace } from "@job/backend";

// Answers copied from real Geoapify responses (lang=fr, filter=countrycode:fr).
const PLACES: Record<string, object[]> = {
  bremoy: [{ result_type: "city", name: "Brémoy", city: "Brémoy", county: "Calvados", state: "Normandie", state_code: "NOR", iso3166_2: "FR-NOR", country: "France", country_code: "fr", lat: 48.9898385, lon: -0.7798309, place_id: "geo-bremoy" }],
  brunoy: [{ result_type: "city", name: "Brunoy", city: "Brunoy", county: "Essonne", state: "Île-de-France", iso3166_2: "FR-IDF", country: "France", country_code: "fr", lat: 48.6979312, lon: 2.5044613, place_id: "geo-brunoy" }],
  yerres: [
    { result_type: "city", name: "Yerres", city: "Yerres", county: "Essonne", state: "Île-de-France", iso3166_2: "FR-IDF", country: "France", country_code: "fr", lat: 48.7178, lon: 2.4931, place_id: "geo-yerres" },
    { result_type: "street", name: "Rue de Yerres", city: "Paris", county: "Paris", state: "Île-de-France", iso3166_2: "FR-IDF", country: "France", country_code: "fr", lat: 48.85, lon: 2.4, place_id: "geo-street" },
  ],
  lyon: [{ result_type: "suburb", name: "Lyon 2e Arrondissement", city: "Lyon", county: "Métropole de Lyon", state: "Auvergne-Rhône-Alpes", iso3166_2: "FR-ARA", country: "France", country_code: "fr", lat: 45.75, lon: 4.82, place_id: "geo-lyon-2" }],
};

let server: Awaited<ReturnType<typeof startTestServer>>;
let geoapify: http.Server;
let calls: string[] = [];
let failing = false;

before(async () => {
  server = await startTestServer();
  geoapify = http.createServer((req, res) => {
    const url = new URL(req.url!, "http://localhost");
    const text = url.searchParams.get("text")!.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    calls.push(text);
    if (failing) return res.writeHead(500).end();
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ results: PLACES[text] ?? [] }));
  });
  geoapify.listen(0, "127.0.0.1");
  await new Promise((resolve) => geoapify.once("listening", resolve));
  config.geoapify.apiKey = "test-key";
  config.geoapify.baseUrl = `http://127.0.0.1:${(geoapify.address() as AddressInfo).port}`;
});

after(async () => {
  config.geoapify.apiKey = undefined;
  geoapify.close();
  await prisma.location.deleteMany({ where: { provider: "geoapify" } });
  await server.close();
});

const autocomplete = async (q: string) =>
  (await server.client().get<LocationAutocompleteResponse>(`/api/locations?q=${encodeURIComponent(q)}`)).body.results;

describe("département codes", () => {
  test("from the name, aliases included, else from the postcode", () => {
    assert.equal(departementCode("Essonne"), "91");
    assert.equal(departementCode("cote d'or"), "21");
    assert.equal(departementCode("Côtes-d’Armor"), "22");
    assert.equal(departementCode("Métropole de Lyon"), "69");
    assert.equal(departementCode("Corse-du-Sud"), "2A");
    assert.equal(departementCode("La Réunion"), "974");
    assert.equal(departementCode("Collectivité européenne d'Alsace", "67000"), "67");
    assert.equal(departementCode(null, "97400"), "974");
    assert.equal(departementCode("Unknown", "20000"), null, "Corsica postcodes are ambiguous");
  });

  test("Geoapify results map to our location levels and codes; streets and districts are ignored", () => {
    assert.deepEqual(toGeoPlace(PLACES.brunoy[0]), {
      placeId: "geo-brunoy", type: "city", name: "Brunoy", countryCode: "FR", regionCode: "FR-IDF", regionName: "Île-de-France",
      countyCode: "91", countyName: "Essonne", latitude: 48.6979312, longitude: 2.5044613,
    });
    assert.equal(toGeoPlace(PLACES.yerres[1]), null);
    assert.equal(toGeoPlace(PLACES.lyon[0]), null);
  });
});

describe("autocomplete with Geoapify", () => {
  test("places missing from the table are added once; searching again reuses the row", async () => {
    calls = [];
    clearGeoapifyCache();
    const [bremoy] = await autocomplete("bremoy");
    assert.equal(bremoy.name, "Brémoy");
    assert.equal(bremoy.countyName, "Calvados");
    const row = await prisma.location.findUniqueOrThrow({ where: { id: bremoy.id } });
    assert.deepEqual([row.provider, row.countyCode, row.regionCode], ["geoapify", "14", "FR-NOR"]);

    clearGeoapifyCache();
    calls = [];
    assert.equal((await autocomplete("bremoy"))[0].id, bremoy.id, "same row, no duplicate");
  });

  test("a place already in the table is reused, not duplicated", async () => {
    const seeded = await prisma.location.findFirstOrThrow({ where: { provider: "seed", name: "Brunoy" } });
    const results = await autocomplete("brunoy");
    assert.deepEqual(results.filter((item) => item.name === "Brunoy").map((item) => item.id), [seeded.id]);
  });

  test("short queries and Geoapify failures fall back to the table", async () => {
    calls = [];
    await autocomplete("ly");
    assert.deepEqual(calls, [], "no call under 3 characters");

    clearGeoapifyCache();
    failing = true;
    try {
      const results = await autocomplete("lyon");
      assert.ok(results.some((item) => item.name === "Lyon"), "local results still returned");
    } finally {
      failing = false;
    }
  });

  test("identical searches are cached", async () => {
    clearGeoapifyCache();
    calls = [];
    await autocomplete("zzz-unknown");
    await autocomplete("zzz-unknown");
    assert.equal(calls.length, 1);
  });

  test("a stored city works in search with its département code and coordinates", async () => {
    clearGeoapifyCache();
    const yerres = (await autocomplete("yerres")).find((item) => item.name === "Yerres")!;
    const { body } = await server.client().get<OfferSearchResponse>(`/api/offers?locationId=${yerres.id}&radius=10&includeRemote=false`);
    const brunoyOffer = body.results.find((offer) => offer.id === seedOfferId("edge-brunoy-fullstack"));
    assert.equal(brunoyOffer?.locationMatch, "exact", "Brunoy is within 10 km of Yerres");
    const all = await server.client().get<OfferSearchResponse>(`/api/offers?locationId=${yerres.id}&radius=10&includeRemote=false&page=${body.totalPages}`);
    assert.ok(all.body.results.some((offer) => offer.locationMatch === "wider_area"), "département/region offers included");
  });

  test("extracted offer places missing from the table are found with Geoapify", async () => {
    await prisma.location.deleteMany({ where: { provider: "geoapify", name: "Yerres" } });
    clearGeoapifyCache();
    const id = await matchLocation(prisma, { city: "Yerres", region: null, countryCode: "FR" });
    assert.ok(id);
    assert.equal((await prisma.location.findUniqueOrThrow({ where: { id } })).countyCode, "91");
  });
});
