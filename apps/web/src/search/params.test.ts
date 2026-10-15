import assert from "node:assert/strict";
import { describe, test } from "vitest";
import { activeFilterCount, apiQuery, readSearch, writeSearch } from "./params";

describe("search in the address", () => {
  test("defaults stay out of the address; values round-trip", () => {
    const state = readSearch(new URLSearchParams("q=react&locationId=12&location=Lyon&radius=50&contractType=permanent,internship&sort=recent"));
    assert.deepEqual([state.q, state.locationId, state.locationName, state.radius, state.contractType, state.sort], ["react", 12, "Lyon", 50, ["permanent", "internship"], "recent"]);
    assert.equal(writeSearch(state).toString(), "q=react&locationId=12&location=Lyon&radius=50&contractType=permanent%2Cinternship&sort=recent");
    assert.equal(writeSearch(readSearch(new URLSearchParams(""))).toString(), "");
  });

  test("invalid values are ignored; the place's name isn't sent to the API", () => {
    const state = readSearch(new URLSearchParams("radius=7&contractType=nope,permanent&publishedWithin=1y&locationId=3&location=Brunoy"));
    assert.deepEqual([state.radius, state.contractType, state.publishedWithin], [25, ["permanent"], null]);
    assert.equal(apiQuery(state), "contractType=permanent&locationId=3");
    assert.equal(activeFilterCount(state), 1);
  });
});
