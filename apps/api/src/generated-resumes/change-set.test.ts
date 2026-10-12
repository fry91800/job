import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { emptyResumeContent, type ResumeChange, type ResumeContent } from "@job/shared";
import { applyChanges, computeChanges, markEditedChanges, setChangeStatus, type Proposal, type Sections, type Strength } from "./change-set";

const ALL: Sections = { summary: true, title: true, skills: true, workExperience: true, projects: true };

function original(): ResumeContent {
  return {
    ...emptyResumeContent("Camille Martin"),
    basics: { ...emptyResumeContent("Camille Martin").basics, title: "Développeuse" },
    summary: "Développeuse web.",
    skills: [
      { id: "s1", name: "JavaScript", category: "technical" },
      { id: "s2", name: "PHP", category: "technical" },
      { id: "s3", name: "Git", category: "technical" },
    ],
    workExperience: [
      {
        id: "w1", jobTitle: "Développeuse", company: "Nexora", location: null, startDate: "2021", endDate: null, isCurrent: true,
        responsibilities: [{ id: "r1", text: "Développement web." }, { id: "r2", text: "Support utilisateurs." }, { id: "r3", text: "Tests." }],
        technologies: [],
      },
    ],
    projects: [
      { id: "p1", name: "Blog", description: "Un blog.", technologies: [], link: null, highlights: [{ id: "h1", text: "Rapide" }, { id: "h2", text: "Simple" }] },
      { id: "p2", name: "Jeu", description: null, technologies: [], link: null, highlights: [] },
    ],
  };
}

let counter = 0;
const newId = () => `n${++counter}`;
const compute = (proposal: Proposal, strength: Strength = "hard", sections: Sections = ALL) => computeChanges(original(), proposal, sections, strength, newId);
const byOp = (changes: ResumeChange[], op: ResumeChange["op"]) => changes.filter((change) => change.op === op);

describe("computeChanges", () => {
  test("one replace per rewritten text, ids c1…", () => {
    const { changes, violations } = compute({
      summary: "Développeuse full stack orientée React.",
      title: "Développeuse React",
      workExperience: [{ id: "w1", responsibilities: [{ id: "r1", text: "Développement d'applications React." }, { id: "r2", text: "Support utilisateurs." }, { id: "r3", text: "Tests." }] }],
    });
    assert.deepEqual(violations, []);
    assert.deepEqual(changes.map((change) => [change.id, change.op, change.path]), [
      ["c1", "replace", "summary"],
      ["c2", "replace", "basics.title"],
      ["c3", "replace", "workExperience[id=w1].responsibilities[id=r1].text"],
    ]);
    assert.equal(changes[2].before, "Développement web.");
    assert.ok(changes.every((change) => change.status === "pending"));
  });

  test("removals, additions and order of skills", () => {
    const { changes } = compute({
      skills: [
        { id: "s3", name: "Git", category: "technical" },
        { id: "s1", name: "JavaScript (ES2022)", category: "technical" },
        { name: "React", category: "technical" },
      ],
    });
    assert.deepEqual(byOp(changes, "replace").map((change) => change.path), ["skills[id=s1].name"]);
    assert.deepEqual(byOp(changes, "remove").map((change) => change.path), ["skills[id=s2]"]);
    const [added] = byOp(changes, "add");
    assert.equal(added.flag, "added_skill");
    assert.deepEqual(added.after, { id: added.path.match(/id=(\w+)/)![1], name: "React", category: "technical" });
    assert.deepEqual(byOp(changes, "reorder").map((change) => [change.path, change.before, change.after]), [["skills", ["s1", "s2", "s3"], ["s3", "s1"]]]);
  });

  test("strengths: soft only rewrites and reorders, medium also removes, only hard adds skills", () => {
    const proposal: Proposal = { skills: [{ id: "s3", name: "Git", category: "technical" }, { id: "s1", name: "JavaScript", category: "technical" }, { name: "React", category: "technical" }] };
    const soft = compute(proposal, "soft");
    assert.deepEqual(soft.changes.map((change) => change.op), ["reorder"]);
    assert.equal(soft.violations.length, 2);
    const medium = compute(proposal, "medium");
    assert.deepEqual(medium.changes.map((change) => change.op).sort(), ["remove", "reorder"]);
    const hard = compute(proposal, "hard");
    assert.deepEqual(hard.changes.map((change) => change.op).sort(), ["add", "remove", "reorder"]);
  });

  test("sections not allowed, added experiences or responsibilities, and new text for empty fields are dropped", () => {
    const { changes, violations } = compute(
      {
        summary: "Nouveau résumé",
        workExperience: [
          { id: "w1", responsibilities: [{ id: "r1", text: "Développement web." }, { id: "r2", text: "Support utilisateurs." }, { id: "r3", text: "Tests." }, { text: "Invented responsibility" }] },
          { id: "w9", responsibilities: [] },
        ],
        projects: [{ id: "p2", description: "Invented description", highlights: [] }, { id: "p1", description: "Un blog.", highlights: [{ id: "h1", text: "Rapide" }, { id: "h2", text: "Simple" }] }],
      },
      "hard",
      { workExperience: true, projects: true },
    );
    assert.deepEqual(changes.map((change) => [change.op, change.path]), [["reorder", "projects"]]);
    assert.ok(violations.includes("summary: not allowed"));
    assert.ok(violations.includes("workExperience[id=w1].responsibilities: item added"));
    assert.ok(violations.includes("workExperience: unknown or added experience"));
    assert.ok(violations.includes("projects[id=p2].description: new text for an empty field"));
  });

  test("never removes every responsibility of an experience", () => {
    const { changes, violations } = compute({ workExperience: [{ id: "w1", responsibilities: [] }] }, "medium");
    assert.deepEqual(changes, []);
    assert.deepEqual(violations, ["workExperience[id=w1].responsibilities: cannot remove every item"]);
  });

  test("no proposal, no change; an id sent twice counts once", () => {
    assert.deepEqual(compute({}).changes, []);
    const { changes } = compute({ skills: [{ id: "s1", name: "JS", category: "technical" }, { id: "s1", name: "Other", category: "technical" }, { id: "s2", name: "PHP", category: "technical" }, { id: "s3", name: "Git", category: "technical" }] });
    assert.deepEqual(changes.map((change) => [change.op, change.after]), [["replace", "JS"]]);
  });
});

describe("applying and reviewing changes (D30, M4)", () => {
  const proposal: Proposal = {
    summary: "Résumé réécrit.",
    skills: [{ id: "s3", name: "Git", category: "technical" }, { id: "s1", name: "JavaScript", category: "technical" }, { name: "React", category: "technical" }],
  };

  function setup() {
    const base = original();
    const { changes } = computeChanges(base, proposal, ALL, "hard", () => "new");
    return { base, changes, content: applyChanges(base, changes) };
  }
  const skillNames = (content: ResumeContent) => content.skills.map((skill) => skill.name);
  const find = (changes: ResumeChange[], op: string) => changes.find((change) => change.op === op)!.id;

  test("pending changes count as accepted: replace → remove → add → reorder", () => {
    const { content } = setup();
    assert.equal(content.summary, "Résumé réécrit.");
    assert.deepEqual(skillNames(content), ["Git", "JavaScript", "React"]);
  });

  test("rejecting a removal puts the item back after its original predecessor", () => {
    const { base, changes, content } = setup();
    const result = setChangeStatus(content, base, changes, find(changes, "remove"), "rejected");
    // Original order: JavaScript, PHP, Git → PHP goes right after JavaScript.
    assert.deepEqual(skillNames(result.content), ["Git", "JavaScript", "PHP", "React"]);
    // Accepting it again removes it again.
    const again = setChangeStatus(result.content, base, result.changes, find(changes, "remove"), "accepted");
    assert.deepEqual(skillNames(again.content), ["Git", "JavaScript", "React"]);
  });

  test("rejecting the reorder restores the original order, added items at the end", () => {
    const { base, changes, content } = setup();
    const result = setChangeStatus(content, base, changes, find(changes, "reorder"), "rejected");
    assert.deepEqual(skillNames(result.content), ["JavaScript", "Git", "React"]);
  });

  test("rejecting an added skill removes it; rejecting a replace restores the text", () => {
    const { base, changes, content } = setup();
    let result = setChangeStatus(content, base, changes, find(changes, "add"), "rejected");
    assert.deepEqual(skillNames(result.content), ["Git", "JavaScript"]);
    result = setChangeStatus(result.content, base, result.changes, find(changes, "replace"), "rejected");
    assert.equal(result.content.summary, "Développeuse web.");
    assert.equal(result.changes.find((change) => change.op === "replace")!.status, "rejected");
  });

  test("decisions keep manual edits made elsewhere", () => {
    const { base, changes, content } = setup();
    const edited = structuredClone(content);
    edited.basics.fullName = "Camille M.";
    const result = setChangeStatus(edited, base, changes, find(changes, "replace"), "rejected");
    assert.equal(result.content.basics.fullName, "Camille M.");
  });

  test("editing a changed field by hand marks the change edited, and it can no longer be decided", () => {
    const { base, changes, content } = setup();
    const next = structuredClone(content);
    next.summary = "Écrit à la main.";
    next.skills = next.skills.filter((skill) => skill.name !== "React");
    const marked = markEditedChanges(content, next, changes);
    assert.deepEqual(marked.filter((change) => change.status === "edited").map((change) => change.op).sort(), ["add", "reorder", "replace"]);
    assert.equal(marked.find((change) => change.op === "remove")!.status, "pending", "untouched target");
    assert.throws(() => setChangeStatus(next, base, marked, find(changes, "replace"), "rejected"), /edited by hand/);
  });
});
