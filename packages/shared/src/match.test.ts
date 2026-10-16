import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { computeMatch, displayScore, MATCH_CONFIG } from "./match";

// The plain shares, without the display curve.
const RAW = { ...MATCH_CONFIG, skillsForFull: null, displayExponent: 1 };

describe("computeMatch (FEATURE O4)", () => {
  test("skills count 80 % and a shared occupation 20 % when the offer has occupations", () => {
    const result = computeMatch({ skillIds: [1, 2, 3, 4], occupationIds: [10] }, { skillIds: [1, 2, 9], occupationIds: [10] }, RAW);
    assert.equal(result.score, Math.round(100 * (0.8 * 0.5 + 0.2)));
    assert.equal(result.rawScore, 60);
    assert.deepEqual(result.matchedSkillIds, [1, 2]);
    assert.deepEqual(result.missingSkillIds, [3, 4]);
    assert.equal(result.sharesOccupation, true);
  });

  test("without a shared occupation", () => {
    assert.equal(computeMatch({ skillIds: [1, 2], occupationIds: [10] }, { skillIds: [1, 2], occupationIds: [11] }, RAW).score, 80);
  });

  test("offers without occupations use the skill score only", () => {
    assert.equal(computeMatch({ skillIds: [1, 2, 3], occupationIds: [] }, { skillIds: [1], occupationIds: [] }, RAW).score, 33);
  });

  test("offers without skills have no score", () => {
    const result = computeMatch({ skillIds: [], occupationIds: [10] }, { skillIds: [1], occupationIds: [10] });
    assert.equal(result.score, null);
    assert.equal(result.rawScore, null);
  });

  test("duplicate offer skill ids count once", () => {
    assert.equal(computeMatch({ skillIds: [1, 1, 2], occupationIds: [] }, { skillIds: [1], occupationIds: [] }, RAW).score, 50);
  });
});

describe("skills for full coverage", () => {
  test("a long skill list is covered by `skillsForFull` matched skills", () => {
    const offer = { skillIds: Array.from({ length: 20 }, (_, index) => index + 1), occupationIds: [] };
    const config = { ...RAW, skillsForFull: 8 };
    assert.equal(computeMatch(offer, { skillIds: [1, 2, 3, 4], occupationIds: [] }, config).score, 50);
    assert.equal(computeMatch(offer, { skillIds: [1, 2, 3, 4, 5, 6, 7, 8, 9], occupationIds: [] }, config).score, 100);
  });

  test("short skill lists are unchanged", () => {
    assert.equal(computeMatch({ skillIds: [1, 2, 3], occupationIds: [] }, { skillIds: [1], occupationIds: [] }, { ...RAW, skillsForFull: 8 }).score, 33);
  });
});

describe("displayed score", () => {
  test("lifts low and middle scores, keeps the order", () => {
    const config = { ...MATCH_CONFIG, displayExponent: 0.5 };
    assert.deepEqual([0, 0.2, 0.4, 0.6, 0.8].map((raw) => displayScore(raw, config)), [0, 45, 63, 77, 89]);
  });

  test("only a perfect match shows 100", () => {
    assert.equal(displayScore(0.996, { ...MATCH_CONFIG, displayExponent: 0.5 }), 99);
    assert.equal(computeMatch({ skillIds: [1, 2], occupationIds: [10] }, { skillIds: [1, 2], occupationIds: [10] }).score, 100);
  });

  test("the default curve is applied", () => {
    const result = computeMatch({ skillIds: [1, 2, 3, 4, 5], occupationIds: [] }, { skillIds: [1], occupationIds: [] }, { ...MATCH_CONFIG, skillsForFull: null });
    assert.equal(result.rawScore, 20);
    assert.equal(result.score, displayScore(0.2));
    assert.equal(computeMatch({ skillIds: [1, 2, 3, 4, 5], occupationIds: [] }, { skillIds: [1], occupationIds: [] }).score, displayScore(0.2));
    assert.ok(result.score! > 20);
  });
});
