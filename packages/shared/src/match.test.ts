import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { computeMatch } from "./match";

describe("computeMatch (FEATURE O4)", () => {
  test("skills count 80 % and a shared occupation 20 % when the offer has occupations", () => {
    const result = computeMatch({ skillIds: [1, 2, 3, 4], occupationIds: [10] }, { skillIds: [1, 2, 9], occupationIds: [10] });
    assert.equal(result.score, Math.round(100 * (0.8 * 0.5 + 0.2)));
    assert.deepEqual(result.matchedSkillIds, [1, 2]);
    assert.deepEqual(result.missingSkillIds, [3, 4]);
    assert.equal(result.sharesOccupation, true);
  });

  test("without a shared occupation", () => {
    assert.equal(computeMatch({ skillIds: [1, 2], occupationIds: [10] }, { skillIds: [1, 2], occupationIds: [11] }).score, 80);
  });

  test("offers without occupations use the skill score only", () => {
    assert.equal(computeMatch({ skillIds: [1, 2, 3], occupationIds: [] }, { skillIds: [1], occupationIds: [] }).score, 33);
  });

  test("offers without skills have no score", () => {
    assert.equal(computeMatch({ skillIds: [], occupationIds: [10] }, { skillIds: [1], occupationIds: [10] }).score, null);
  });

  test("duplicate offer skill ids count once", () => {
    assert.equal(computeMatch({ skillIds: [1, 1, 2], occupationIds: [] }, { skillIds: [1], occupationIds: [] }).score, 50);
  });
});
