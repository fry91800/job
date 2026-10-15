import type { ResumeChange, ResumeContent } from "@job/shared";

// Where a change is, in words: "Experience · Full stack developer · Responsibility"
// (FEATURE M4). Paths look like "workExperience[id=w1].responsibilities[id=r2].text".

export type Section = "basics" | "summary" | "skills" | "workExperience" | "projects" | "other";

export function sectionOf(change: ResumeChange): Section {
  const first = /^(\w+)/.exec(change.path)?.[1] ?? "";
  return (["basics", "summary", "skills", "workExperience", "projects"] as string[]).includes(first) ? (first as Section) : "other";
}

const idIn = (path: string, list: string) => new RegExp(`${list}\\[id=([\\w-]+)\\]`).exec(path)?.[1];

// The item's own name, for the label: a job's title, a project's name, a skill.
export function changeContext(change: ResumeChange, original: ResumeContent, generated: ResumeContent): string | null {
  const find = <T extends { id: string }>(items: T[], id: string | undefined) => (id ? items.find((item) => item.id === id) : undefined);
  const jobId = idIn(change.path, "workExperience");
  if (jobId) return (find(original.workExperience, jobId) ?? find(generated.workExperience, jobId))?.jobTitle ?? null;
  const projectId = idIn(change.path, "projects");
  if (projectId) return (find(original.projects, projectId) ?? find(generated.projects, projectId))?.name ?? null;
  return null;
}

// What kind of field: "summary", "title", "skill", "responsibility", "description",
// "highlight", "order" (a reordered list), "item".
export function fieldOf(change: ResumeChange): string {
  if (change.op === "reorder") return "order";
  const path = change.path;
  if (path === "summary") return "summary";
  if (path === "basics.title") return "title";
  if (/^skills/.test(path)) return "skill";
  if (/responsibilities/.test(path)) return "responsibility";
  if (/highlights/.test(path)) return "highlight";
  if (/\.description$/.test(path)) return "description";
  if (/^projects\[id=[\w-]+\]$/.test(path)) return "project";
  return "item";
}

// The text of a value: a string, or an item's name / text.
export function valueText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const item = value as Record<string, unknown>;
    return String(item.name ?? item.text ?? item.jobTitle ?? "");
  }
  return "";
}

// Names of the items of a reordered list, in a given order of ids.
export function namesInOrder(change: ResumeChange, ids: unknown, original: ResumeContent): string[] {
  if (!Array.isArray(ids)) return [];
  const listPath = change.path;
  const items: { id: string }[] =
    listPath === "skills"
      ? original.skills
      : listPath === "projects"
        ? original.projects
        : (() => {
            const jobId = idIn(listPath, "workExperience");
            const projectId = idIn(listPath, "projects");
            if (jobId) return original.workExperience.find((job) => job.id === jobId)?.responsibilities ?? [];
            if (projectId) return original.projects.find((project) => project.id === projectId)?.highlights ?? [];
            return [];
          })();
  return ids.map((id) => valueText(items.find((item) => item.id === id)) || String(id));
}
