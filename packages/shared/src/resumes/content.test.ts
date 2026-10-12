import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { emptyResumeContent, resumeContentSchema, withItemIds } from "./content";

const base = () => structuredClone(emptyResumeContent("Camille Martin")) as any;
const job = (fields: object = {}) => ({
  jobTitle: "Développeuse", company: "Nexora", location: null, startDate: "2021-01", endDate: "2022-06",
  isCurrent: false, responsibilities: [], technologies: [], ...fields,
});

describe("ResumeContent v1", () => {
  test("accepts the minimal document", () => {
    assert.ok(resumeContentSchema.safeParse(base()).success);
  });

  test("turns empty strings into null", () => {
    const content = base();
    content.summary = "  ";
    content.basics.title = "";
    const parsed = resumeContentSchema.parse(content);
    assert.equal(parsed.summary, null);
    assert.equal(parsed.basics.title, null);
  });

  test("rejects unknown keys, bad dates and inconsistent current jobs", () => {
    assert.equal(resumeContentSchema.safeParse({ ...base(), photo: "x" }).success, false);
    assert.equal(resumeContentSchema.safeParse({ ...base(), workExperience: [job({ startDate: "2021-13" })] }).success, false);
    assert.equal(resumeContentSchema.safeParse({ ...base(), workExperience: [job({ endDate: "Present" })] }).success, false);
    assert.equal(resumeContentSchema.safeParse({ ...base(), workExperience: [job({ isCurrent: true })] }).success, false);
    assert.equal(resumeContentSchema.safeParse({ ...base(), workExperience: [job({ startDate: "2023", endDate: "2022-01" })] }).success, false);
    assert.ok(resumeContentSchema.safeParse({ ...base(), workExperience: [job({ isCurrent: true, endDate: null })] }).success);
  });

  test("rejects duplicate item ids", () => {
    const content = { ...base(), skills: [{ id: "a", name: "Go", category: "technical" }, { id: "a", name: "SQL", category: "technical" }] };
    assert.equal(resumeContentSchema.safeParse(content).success, false);
  });

  test("withItemIds keeps existing ids and fills the missing ones without collisions", () => {
    const content = resumeContentSchema.parse({
      ...base(),
      skills: [{ id: "s1", name: "Go", category: "technical" }, { name: "SQL", category: "technical" }],
      workExperience: [job({ responsibilities: [{ text: "Built things" }] })],
    });
    const ids = ["s1", "x1", "x2", "x3"];
    const result = withItemIds(content, () => ids.shift()!);
    assert.equal(result.skills[0].id, "s1");
    assert.equal(result.skills[1].id, "x1", "s1 is already used, so the generator is called again");
    assert.equal(result.workExperience[0].id, "x2");
    assert.equal(result.workExperience[0].responsibilities[0].id, "x3");
    assert.equal(content.skills[1].id, undefined, "the input is not modified");
  });
});
