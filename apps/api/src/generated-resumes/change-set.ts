import type { ResumeChange, ResumeContent } from "@job/shared";

// Change sets (DATABASE.md "Change set", FEATURE M4). Pure functions, no I/O:
// * computeChanges: original + AI proposal → the reviewable changes, keeping only what
//   the modifier settings and strength allow;
// * applyChanges: original + changes → generated content (every change not rejected);
// * setChangeStatus: accept/reject one change on the CURRENT content, so manual edits
//   made elsewhere are kept;
// * markEditedChanges: after a manual edit, changes whose target was edited become `edited`.

export type Strength = "soft" | "medium" | "hard";
export type Sections = { summary?: boolean; title?: boolean; skills?: boolean; workExperience?: boolean; projects?: boolean };

type Item = { id: string } & Record<string, unknown>;

// What the AI may send back: only the allowed sections, items identified by their id.
export type Proposal = {
  summary?: string | null;
  title?: string | null;
  skills?: { id?: string | null; name: string; category: "technical" | "soft" }[];
  workExperience?: { id: string; responsibilities: { id?: string | null; text: string }[] }[];
  projects?: { id: string; description: string | null; highlights: { id?: string | null; text: string }[] }[];
};

// ───────────────────────────── Paths ─────────────────────────────

type Step = { key: string; id?: string };

function parsePath(path: string): Step[] {
  return path.split(".").map((part) => {
    const match = /^(\w+)(?:\[id=([\w-]+)\])?$/.exec(part);
    if (!match) throw new Error(`Invalid change path: ${path}`);
    return { key: match[1], id: match[2] };
  });
}

// Follows the steps; returns undefined when something on the way is missing.
function resolve(content: unknown, steps: Step[]): unknown {
  let node: unknown = content;
  for (const step of steps) {
    if (!node || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[step.key];
    if (step.id !== undefined) {
      if (!Array.isArray(node)) return undefined;
      node = node.find((item: Item) => item.id === step.id);
    }
  }
  return node;
}

// "workExperience[id=w1].responsibilities[id=r2]" → the list and the item id.
function listTarget(content: unknown, path: string): { list: Item[] | undefined; id: string | undefined } {
  const steps = parsePath(path);
  const last = steps[steps.length - 1];
  const parent = resolve(content, steps.slice(0, -1));
  const list = parent && typeof parent === "object" ? (parent as Record<string, unknown>)[last.key] : undefined;
  return { list: Array.isArray(list) ? (list as Item[]) : undefined, id: last.id };
}

// The value at a change path ("summary", "skills[id=s3].name"…), undefined if missing.
export function getText(content: unknown, path: string): unknown {
  return resolve(content, parsePath(path));
}

function setText(content: unknown, path: string, value: unknown): void {
  const steps = parsePath(path);
  const last = steps[steps.length - 1];
  const parent = resolve(content, steps.slice(0, -1));
  if (parent && typeof parent === "object") (parent as Record<string, unknown>)[last.key] = value;
}

const listPathOf = (itemPath: string) => itemPath.replace(/\[id=[\w-]+\]$/, "");
const ids = (list: Item[]) => list.map((item) => item.id);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// ───────────────────────────── Ordering (D30) ─────────────────────────────

// Orders `list` by `order`. Ids no longer in the list are skipped. Items missing from
// `order` go right after the item that preceded them in `originalOrder`; items that were
// not in the original (added) go at the end.
function orderList(list: Item[], order: string[], originalOrder: string[]): Item[] {
  const byId = new Map(list.map((item) => [item.id, item]));
  const result = order.filter((id) => byId.has(id)).map((id) => byId.get(id)!);
  const placed = new Set(result.map((item) => item.id));
  const added: Item[] = [];

  for (const item of list) {
    if (placed.has(item.id)) continue;
    const originalIndex = originalOrder.indexOf(item.id);
    if (originalIndex === -1) {
      added.push(item);
      continue;
    }
    let insertAt = 0;
    for (let i = originalIndex - 1; i >= 0; i--) {
      const index = result.findIndex((other) => other.id === originalOrder[i]);
      if (index !== -1) {
        insertAt = index + 1;
        break;
      }
    }
    result.splice(insertAt, 0, item);
    placed.add(item.id);
  }
  return [...result, ...added];
}

function replaceList(list: Item[], items: Item[]): void {
  list.splice(0, list.length, ...items);
}

// ───────────────────────────── Compute ─────────────────────────────

export type ComputeResult = { changes: ResumeChange[]; violations: string[] };

export function computeChanges(
  original: ResumeContent,
  proposal: Proposal,
  sections: Sections,
  strength: Strength,
  newItemId: () => string,
): ComputeResult {
  const changes: Omit<ResumeChange, "id">[] = [];
  const violations: string[] = [];
  const canRemove = strength !== "soft";
  const text = (value: string) => value.trim();

  const replace = (path: string, before: string | null, after: string | null | undefined) => {
    if (after === undefined || after === null || text(after) === "") return;
    // Rewriting is allowed; writing a section that was empty would be inventing content.
    if (before === null) return violations.push(`${path}: new text for an empty field`);
    if (text(after) !== before) changes.push({ op: "replace", path, before, after: text(after), status: "pending", flag: null });
  };

  // One list of items with ids: rewrites, removals, additions and order.
  const diffList = (
    listPath: string,
    originalItems: Item[],
    proposed: { id?: string | null }[],
    options: { textKey?: string; allowAdd: boolean; keepOne: boolean; toNewItem?: (proposed: Record<string, unknown>) => Item | null },
  ) => {
    const originalIds = ids(originalItems);
    // An id sent twice counts once (the first occurrence).
    const known = proposed
      .filter((item): item is Item => typeof item.id === "string" && originalIds.includes(item.id))
      .filter((item, index, all) => all.findIndex((other) => other.id === item.id) === index);
    const unknown = proposed.filter((item) => !(typeof item.id === "string" && originalIds.includes(item.id)));
    const keptIds = [...new Set(known.map((item) => item.id))];

    // Rewritten texts.
    const textKey = options.textKey;
    if (textKey) {
      for (const item of known) {
        const before = originalItems.find((other) => other.id === item.id)![textKey] as string | null;
        replace(`${listPath}[id=${item.id}].${textKey}`, before, item[textKey] as string | null | undefined);
      }
    }

    // Removed items.
    let removed = originalIds.filter((id) => !keptIds.includes(id));
    if (removed.length > 0 && !canRemove) {
      violations.push(`${listPath}: removals need the medium or hard strength`);
      removed = [];
    }
    if (options.keepOne && removed.length > 0 && removed.length === originalIds.length) {
      violations.push(`${listPath}: cannot remove every item`);
      removed = [];
    }
    for (const id of removed) {
      changes.push({ op: "remove", path: `${listPath}[id=${id}]`, before: originalItems.find((item) => item.id === id), after: null, status: "pending", flag: null });
    }

    // Added items.
    for (const item of unknown) {
      if (!options.allowAdd || !options.toNewItem) {
        violations.push(`${listPath}: item added`);
        continue;
      }
      const added = options.toNewItem(item as Record<string, unknown>);
      if (!added) {
        violations.push(`${listPath}: added item already present or empty`);
        continue;
      }
      changes.push({ op: "add", path: `${listPath}[id=${added.id}]`, before: null, after: added, status: "pending", flag: "added_skill" });
    }

    // Order of the items kept on both sides.
    const remaining = originalIds.filter((id) => keptIds.includes(id) && !removed.includes(id));
    const proposedOrder = keptIds.filter((id) => remaining.includes(id));
    if (!same(proposedOrder, remaining)) {
      changes.push({ op: "reorder", path: listPath, before: originalIds, after: proposedOrder, status: "pending", flag: null });
    }
  };

  if (sections.summary) replace("summary", original.summary, proposal.summary);
  else if (proposal.summary !== undefined) violations.push("summary: not allowed");

  if (sections.title) replace("basics.title", original.basics.title, proposal.title);
  else if (proposal.title !== undefined) violations.push("title: not allowed");

  if (sections.skills && proposal.skills) {
    const existingNames = new Set(original.skills.map((skill) => skill.name.trim().toLowerCase()));
    diffList("skills", original.skills as Item[], proposal.skills, {
      textKey: "name",
      allowAdd: strength === "hard",
      keepOne: false,
      toNewItem: (item) => {
        const name = typeof item.name === "string" ? item.name.trim() : "";
        if (!name || existingNames.has(name.toLowerCase())) return null;
        existingNames.add(name.toLowerCase());
        return { id: newItemId(), name, category: item.category === "soft" ? "soft" : "technical" };
      },
    });
  } else if (proposal.skills) {
    violations.push("skills: not allowed");
  }

  if (sections.workExperience && proposal.workExperience) {
    for (const job of proposal.workExperience) {
      const originalJob = original.workExperience.find((other) => other.id === job.id);
      if (!originalJob) {
        violations.push("workExperience: unknown or added experience");
        continue;
      }
      diffList(`workExperience[id=${job.id}].responsibilities`, originalJob.responsibilities as Item[], job.responsibilities, {
        textKey: "text",
        allowAdd: false,
        keepOne: true,
      });
    }
  } else if (proposal.workExperience) {
    violations.push("workExperience: not allowed");
  }

  if (sections.projects && proposal.projects) {
    const proposedProjects = proposal.projects.filter((project) => original.projects.some((other) => other.id === project.id));
    if (proposedProjects.length < proposal.projects.length) violations.push("projects: unknown or added project");
    // Order and removal of whole projects (names are never rewritten).
    diffList("projects", original.projects as Item[], proposedProjects, { allowAdd: false, keepOne: false });
    for (const project of proposedProjects) {
      const originalProject = original.projects.find((other) => other.id === project.id)!;
      replace(`projects[id=${project.id}].description`, originalProject.description, project.description);
      diffList(`projects[id=${project.id}].highlights`, originalProject.highlights as Item[], project.highlights ?? [], {
        textKey: "text",
        allowAdd: false,
        keepOne: false,
      });
    }
  } else if (proposal.projects) {
    violations.push("projects: not allowed");
  }

  return { changes: changes.map((change, index) => ({ ...change, id: `c${index + 1}` })), violations };
}

// ───────────────────────────── Apply ─────────────────────────────

const applied = (change: ResumeChange) => change.status !== "rejected";

// Generated content = original + every change that is not rejected, in the order
// replace → remove → add → reorder (D30).
export function applyChanges(original: ResumeContent, changes: ResumeChange[]): ResumeContent {
  const content = structuredClone(original);
  const active = changes.filter((change) => applied(change) && change.status !== "edited");
  for (const op of ["replace", "remove", "add", "reorder"] as const) {
    for (const change of active.filter((item) => item.op === op)) applyOne(content, original, change, changes);
  }
  return content;
}

function applyOne(content: ResumeContent, original: ResumeContent, change: ResumeChange, all: ResumeChange[]): void {
  switch (change.op) {
    case "replace":
      if (getText(content, change.path) !== undefined) setText(content, change.path, change.after);
      return;
    case "remove": {
      const { list, id } = listTarget(content, change.path);
      if (list) replaceList(list, list.filter((item) => item.id !== id));
      return;
    }
    case "add": {
      const { list, id } = listTarget(content, change.path);
      if (list && !list.some((item) => item.id === id)) list.push(structuredClone(change.after as Item));
      reapplyOrder(content, original, listPathOf(change.path), all);
      return;
    }
    case "reorder": {
      const { list } = listTarget(content, `${change.path}[id=x]`);
      if (list) replaceList(list, orderList(list, change.after as string[], change.before as string[]));
      return;
    }
  }
}

// Keeps a list consistent with its reorder change (or the original order if rejected),
// after an item was added or restored.
function reapplyOrder(content: ResumeContent, original: ResumeContent, listPath: string, all: ResumeChange[]): void {
  const reorder = all.find((change) => change.op === "reorder" && change.path === listPath);
  if (reorder?.status === "edited") return;
  const { list } = listTarget(content, `${listPath}[id=x]`);
  const { list: originalList } = listTarget(original, `${listPath}[id=x]`);
  if (!list || !originalList) return;
  const originalOrder = ids(originalList);
  const order = reorder && applied(reorder) ? (reorder.after as string[]) : originalOrder;
  replaceList(list, orderList(list, order, originalOrder));
}

// Accepts or rejects one change on the current content. Accepting a pending change
// changes nothing (pending already counts as accepted).
export function setChangeStatus(
  content: ResumeContent,
  original: ResumeContent,
  changes: ResumeChange[],
  changeId: string,
  status: "accepted" | "rejected",
): { content: ResumeContent; changes: ResumeChange[] } {
  const index = changes.findIndex((change) => change.id === changeId);
  if (index === -1) throw new ChangeSetError("change_not_found", `Unknown change ${changeId}`);
  const change = changes[index];
  if (change.status === "edited") throw new ChangeSetError("change_edited", "This change was edited by hand and can no longer be accepted or rejected");

  const nextChanges = changes.map((item, i) => (i === index ? { ...item, status } : item));
  const next = structuredClone(content);
  const wasApplied = applied(change);
  const isApplied = status !== "rejected";
  if (wasApplied === isApplied) return { content: next, changes: nextChanges };

  switch (change.op) {
    case "replace":
      if (getText(next, change.path) !== undefined) setText(next, change.path, isApplied ? change.after : change.before);
      break;
    case "remove": {
      const { list, id } = listTarget(next, change.path);
      if (!list) break;
      if (isApplied) {
        replaceList(list, list.filter((item) => item.id !== id));
      } else if (!list.some((item) => item.id === id)) {
        list.push(structuredClone(change.before as Item));
        reapplyOrder(next, original, listPathOf(change.path), nextChanges);
      }
      break;
    }
    case "add": {
      const { list, id } = listTarget(next, change.path);
      if (!list) break;
      if (isApplied) {
        if (!list.some((item) => item.id === id)) list.push(structuredClone(change.after as Item));
        reapplyOrder(next, original, listPathOf(change.path), nextChanges);
      } else {
        replaceList(list, list.filter((item) => item.id !== id));
      }
      break;
    }
    case "reorder":
      reapplyOrder(next, original, change.path, nextChanges);
      break;
  }
  return { content: next, changes: nextChanges };
}

// After a manual edit (prev → next), every change whose target was modified by hand
// becomes `edited`: resolved, the manual value wins (M4).
export function markEditedChanges(prev: ResumeContent, next: ResumeContent, changes: ResumeChange[]): ResumeChange[] {
  return changes.map((change) => {
    if (change.status === "edited") return change;
    let touched: boolean;
    if (change.op === "replace") {
      touched = !same(getText(prev, change.path), getText(next, change.path));
    } else if (change.op === "reorder") {
      const before = listTarget(prev, `${change.path}[id=x]`).list;
      const after = listTarget(next, `${change.path}[id=x]`).list;
      touched = !same(before && ids(before), after && ids(after));
    } else {
      const find = (content: ResumeContent) => {
        const { list, id } = listTarget(content, change.path);
        return list?.find((item) => item.id === id);
      };
      touched = !same(find(prev), find(next));
    }
    return touched ? { ...change, status: "edited" } : change;
  });
}

export class ChangeSetError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
