import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { LocationAutocompleteResponse } from "@job/shared";
import { startTestServer } from "../test/helpers";

let server: Awaited<ReturnType<typeof startTestServer>>;

before(async () => {
  server = await startTestServer();
});
after(() => server.close());

const names = async (q: string) =>
  (await server.client().get<LocationAutocompleteResponse>(`/api/locations?q=${encodeURIComponent(q)}`)).body.results.map((item) => item.name);

describe("GET /api/locations", () => {
  test("prefix matches come first", async () => {
    assert.equal((await names("brun"))[0], "Brunoy");
    assert.equal((await names("Ess"))[0], "Essonne");
  });

  test("matches without accents", async () => {
    assert.ok((await names("evry")).includes("Évry-Courcouronnes"));
    assert.ok((await names("ile de france")).includes("Île-de-France"));
  });

  test("returns the level and parent names", async () => {
    const { body } = await server.client().get<LocationAutocompleteResponse>("/api/locations?q=brunoy");
    assert.deepEqual(body.results[0], {
      id: body.results[0].id,
      type: "city",
      name: "Brunoy",
      countryCode: "FR",
      regionName: "Île-de-France",
      countyName: "Essonne",
    });
  });

  test("needs at least 2 characters", async () => {
    assert.equal((await server.client().get("/api/locations?q=b")).status, 400);
  });
});
