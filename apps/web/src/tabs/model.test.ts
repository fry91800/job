import assert from "node:assert/strict";
import { describe, test } from "vitest";
import { closeTabs, EMPTY, ensureTab, keepTab, MAX_TABS, openTab, restore, tabFromPath, tabPath, updateTab, type TabsState } from "./model";

const offer = (id: string) => ({ kind: "offer" as const, id });
const keys = (state: TabsState) => state.tabs.map((tab) => `${tab.key}${tab.preview ? "*" : ""}`);

describe("workspace tabs", () => {
  test("addresses both ways", () => {
    for (const ref of [offer("a b"), { kind: "generated" as const, id: "g1" }, { kind: "letter" as const, id: "l1" }, { kind: "write-letter" as const }, { kind: "new-resume" as const }, { kind: "history" as const }, { kind: "settings" as const }, { kind: "tailor" as const }, { kind: "privacy" as const }, { kind: "terms" as const }]) {
      assert.deepEqual(tabFromPath(tabPath(ref)), ref);
    }
    assert.deepEqual(tabFromPath("/resumes/"), { kind: "resumes" });
    assert.deepEqual(tabFromPath("/adapter-mon-cv"), { kind: "tailor" }, "the tool pages' guided path");
    assert.equal(tabFromPath("/nope"), null);
    assert.equal(tabFromPath("/"), null);
  });

  test("one tab per thing; new tabs open next to the active one", () => {
    let state = openTab(EMPTY, { kind: "resumes" }, { now: 1 });
    state = openTab(state, { kind: "settings" }, { now: 2 });
    state = openTab(state, { kind: "resumes" }, { now: 3 });
    assert.deepEqual(keys(state), ["resumes", "settings"]);
    assert.equal(state.activeKey, "resumes");
    state = openTab(state, offer("1"), { now: 4 });
    assert.deepEqual(keys(state), ["resumes", "offer:1", "settings"]);
  });

  test("a single preview tab is reused, and kept open when opened for real", () => {
    let state = openTab(EMPTY, offer("1"), { preview: true, now: 1 });
    state = openTab(state, offer("2"), { preview: true, now: 2 });
    assert.deepEqual(keys(state), ["offer:2*"]);
    state = openTab(state, offer("2"), { now: 3 });
    assert.deepEqual(keys(state), ["offer:2"]);
    state = openTab(state, offer("3"), { preview: true, now: 4 });
    state = keepTab(state, "offer:3");
    state = openTab(state, offer("4"), { preview: true, now: 5 });
    assert.deepEqual(keys(state), ["offer:2", "offer:3", "offer:4*"]);
  });

  test("closing the active tab shows its right neighbour, else its left one", () => {
    let state = [offer("1"), offer("2"), offer("3")].reduce((current, ref, index) => openTab(current, ref, { now: index }), EMPTY);
    state = { ...state, activeKey: "offer:2" };
    assert.equal(closeTabs(state, ["offer:2"]).activeKey, "offer:3");
    assert.equal(closeTabs({ ...state, activeKey: "offer:3" }, ["offer:3"]).activeKey, "offer:2");
    assert.equal(closeTabs(state, ["offer:1", "offer:2", "offer:3"]).activeKey, null);
    assert.equal(closeTabs(state, ["offer:1"]).activeKey, "offer:2", "another tab closed: same active tab");
  });

  test("beyond the limit the least recently used tab goes, never one with unsaved changes", () => {
    let state = EMPTY;
    for (let i = 0; i < MAX_TABS; i++) state = openTab(state, offer(String(i)), { now: i });
    state = updateTab(state, "offer:0", { dirty: true });
    state = openTab(state, offer("new"), { now: 100 });
    assert.equal(state.tabs.length, MAX_TABS);
    assert.ok(state.tabs.some((tab) => tab.key === "offer:0"), "unsaved changes kept");
    assert.ok(!state.tabs.some((tab) => tab.key === "offer:1"), "least recently used closed");
  });

  test("an address shows the existing tab or opens a kept-open one", () => {
    let state = openTab(EMPTY, offer("1"), { preview: true, now: 1 });
    state = ensureTab(state, offer("1"), 2);
    assert.deepEqual(keys(state), ["offer:1*"], "existing tab shown as it is");
    state = ensureTab(state, { kind: "photos" }, 3);
    assert.deepEqual(keys(state), ["offer:1*", "photos"]);
  });

  test("restored tabs are checked and never dirty", () => {
    const restored = restore({
      tabs: [{ kind: "offer", id: "1", dirty: true, preview: false, title: "Dev", lastActive: 5 }, { kind: "offer" }, { kind: "nope" }, null],
      activeKey: "missing",
    });
    assert.deepEqual(restored.tabs.map((tab) => [tab.key, tab.dirty, tab.title]), [["offer:1", false, "Dev"]]);
    assert.equal(restored.activeKey, "offer:1");
    assert.deepEqual(restore("garbage"), EMPTY);
  });
});
