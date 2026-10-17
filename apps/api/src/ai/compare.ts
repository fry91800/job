// `npm run ai:compare`: runs the real AI tasks on development data with several models and
// writes a report to judge them side by side (D157): validity, rule breaks, tokens, cost,
// time, and the answers themselves. Costs real AI requests (a few cents by default).
//
//   npm run ai:compare -- [--models a,b,c] [--tasks generate,translate,extract,parse] [--samples 2]
//
// Inputs: the development database's resumes (non deleted) and open offers sharing an
// occupation with them; for parsing, the test fixture and the uploaded files in storage/.
// Report: data/ai-compare/<date-time>.md (data/ is not in git: it contains resumes). Run it
// from the repository folder.
import "dotenv/config";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ResumeContent, ResumeLanguage } from "@job/shared";
import { aiPrice, withAiModel, type AiCall } from "@job/backend";
import { config } from "../config";
import { computeChanges } from "../generated-resumes/change-set";
import { proposeModifications } from "../generated-resumes/resume-modifier";
import { newItemId } from "../lib/ids";
import { prisma } from "../lib/prisma";
import { extractOfferDraft } from "../offers/offer-extractor";
import { parseResumeFile } from "../resumes/resume-parser";
import { translateResume } from "../resumes/resume-translator";

// Gemini 2.5 Flash-Lite ($0.10 / $0.40) is no longer open to new API users (2026-10).
const DEFAULT_MODELS = ["gemini-3.8-flash", "gemini-3.5-flash-lite"];
const TASKS = ["generate", "translate", "extract", "parse"] as const;
type Task = (typeof TASKS)[number];

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const models = option("models")?.split(",").map((model) => model.trim()).filter(Boolean) ?? DEFAULT_MODELS;
const tasks = (option("tasks")?.split(",") ?? [...TASKS]).filter((task): task is Task => (TASKS as readonly string[]).includes(task));
const samples = Number(option("samples") ?? 2);

type Run = { task: Task; sample: string; model: string; ok: boolean; error?: string; calls: AiCall[]; output: string; violations?: number };
const runs: Run[] = [];

async function measure(task: Task, sample: string, model: string, fn: () => Promise<{ output: string; violations?: number }>) {
  const calls: AiCall[] = [];
  process.stdout.write(`${task} · ${sample} · ${model} … `);
  try {
    const result = await withAiModel(model, calls, fn);
    runs.push({ task, sample, model, ok: true, calls, ...result });
    console.log(`ok ($${sum(calls, "costUsd").toFixed(4)}, ${(sum(calls, "ms") / 1000).toFixed(1)} s)`);
  } catch (error) {
    const message = error instanceof Error ? `${(error as { code?: string }).code ?? ""} ${error.message}`.trim() : String(error);
    runs.push({ task, sample, model, ok: false, error: message, calls, output: "" });
    console.log(`FAILED: ${message}`);
  }
}

const sum = (calls: AiCall[], key: "inputTokens" | "outputTokens" | "costUsd" | "ms") => calls.reduce((total, call) => total + call[key], 0);
const quote = (text: unknown) => String(text ?? "∅").replace(/\n+/g, " ⏎ ").slice(0, 600);

// ───────────────────────────── Inputs ─────────────────────────────

async function loadResumes() {
  const rows = await prisma.resume.findMany({
    where: { deletedAt: null, translatedFromResumeId: null },
    orderBy: { createdAt: "desc" },
    take: samples,
    select: { id: true, name: true, language: true, content: true, occupations: { select: { occupationId: true } } },
  });
  return rows.map((row) => ({ ...row, content: row.content as ResumeContent }));
}

// Open offers in the resume's language sharing an occupation with it (else recent ones),
// with a description long enough to adapt to.
async function offersFor(resume: Awaited<ReturnType<typeof loadResumes>>[number]) {
  const occupationIds = resume.occupations.map((link) => link.occupationId);
  const where = { isPublic: true, closedAt: null, language: resume.language };
  let offers = await prisma.offer.findMany({
    where: { ...where, ...(occupationIds.length > 0 && { occupations: { some: { occupationId: { in: occupationIds } } } }) },
    orderBy: { publishedAt: { sort: "desc", nulls: "last" } },
    take: 50,
    include: { skills: { select: { skill: { select: { names: { where: { isCanonical: true, language: resume.language }, select: { name: true } } } } } } },
  });
  offers = offers.filter((offer) => offer.description.length >= 1200 && offer.description.length <= 8000);
  return offers.slice(0, samples);
}

// ───────────────────────────── Tasks ─────────────────────────────

async function compareGenerate() {
  for (const resume of await loadResumes()) {
    for (const offer of await offersFor(resume)) {
      const sample = `${resume.name} × ${offer.title} (${offer.companyName ?? "?"})`;
      for (const model of models) {
        await measure("generate", sample, model, async () => {
          const sections = config.modifier.sectionsByStrength.medium;
          const { proposal } = await proposeModifications({
            resume: resume.content,
            language: resume.language,
            offer: { title: offer.title, companyName: offer.companyName, description: offer.description, skillNames: offer.skills.map((link) => link.skill.names[0]?.name).filter(Boolean) as string[] },
            strength: "medium",
            sections,
          });
          const { changes, violations } = computeChanges(resume.content, proposal, sections, "medium", newItemId);
          const lines = changes.map((change) => {
            if (change.op === "replace") return `- **${change.path}**\n  - avant : ${quote(change.before)}\n  - après : ${quote(change.after)}`;
            if (change.op === "remove") return `- **${change.path}** supprimé : ${quote(JSON.stringify(change.before))}`;
            if (change.op === "add") return `- **${change.path}** ajouté : ${quote(JSON.stringify(change.after))}`;
            return `- **${change.path}** réordonné`;
          });
          const dropped = violations.length ? `\n\n⚠️ ${violations.length} modification(s) refusée(s) (règles non respectées) : ${violations.slice(0, 5).join(" ; ")}` : "";
          return { output: `${changes.length} modification(s)\n\n${lines.join("\n")}${dropped}`, violations: violations.length };
        });
      }
    }
  }
}

async function compareTranslate() {
  const resume = (await loadResumes())[0];
  if (!resume) return;
  const to: ResumeLanguage = resume.language === "fr" ? "en" : "fr";
  for (const model of models) {
    await measure("translate", `${resume.name} (${resume.language} → ${to})`, model, async () => {
      const translated = await translateResume(resume.content, resume.language as ResumeLanguage, to);
      const job = translated.workExperience[0];
      const originalJob = resume.content.workExperience[0];
      const lines = [
        `- **titre** : ${quote(resume.content.basics.title)} → ${quote(translated.basics.title)}`,
        `- **résumé** : ${quote(translated.summary)}`,
        ...(job ? [`- **${quote(originalJob?.jobTitle)}** → **${quote(job.jobTitle)}**`, ...job.responsibilities.slice(0, 4).map((item, index) => `  - ${quote(originalJob?.responsibilities[index]?.text)}\n    → ${quote(item.text)}`)] : []),
        `- **compétences** : ${translated.skills.map((skill) => skill.name).join(", ")}`,
      ];
      return { output: lines.join("\n") };
    });
  }
}

async function compareExtract() {
  const resume = (await loadResumes())[0];
  const offers = resume ? await offersFor(resume) : [];
  for (const offer of offers) {
    const text = [offer.title, offer.companyName, offer.description].filter(Boolean).join("\n\n");
    for (const model of models) {
      await measure("extract", `${offer.title} (${offer.companyName ?? "?"})`, model, async () => {
        const draft = await extractOfferDraft({ text });
        const { description: _description, ...fields } = draft;
        return { output: "```json\n" + JSON.stringify(fields, null, 1) + "\n```" };
      });
    }
  }
}

async function compareParse() {
  const files = [join(process.cwd(), "apps/api/src/test/fixtures/resume.docx")];
  const storageDir = join(config.storage.localDir, "resume-sources");
  try {
    for (const owner of readdirSync(storageDir)) {
      for (const name of readdirSync(join(storageDir, owner))) files.push(join(storageDir, owner, name));
    }
  } catch {
    // No uploads in development.
  }
  const chosen = files.filter((file) => /\.(pdf|docx)$/i.test(file) && statSync(file).size > 0).slice(0, samples);
  for (const file of chosen) {
    const type = file.toLowerCase().endsWith(".pdf") ? "pdf" : "docx";
    for (const model of models) {
      await measure("parse", `${type === "pdf" ? "PDF" : "DOCX"} ${file.split("/").pop()!.slice(0, 12)}`, model, async () => {
        const { content, language } = await parseResumeFile(readFileSync(file), type);
        const jobs = (content.workExperience ?? []).map((job) => `${job.jobTitle} @ ${job.company} (${job.responsibilities?.length ?? 0} missions)`);
        const lines = [
          `- langue ${language} · ${content.basics?.fullName ?? "?"} · ${quote(content.basics?.title)}`,
          `- ${jobs.length} expériences : ${jobs.join(" ; ")}`,
          `- ${(content.education ?? []).length} formations · ${(content.skills ?? []).length} compétences : ${(content.skills ?? []).map((skill) => skill.name).join(", ")}`,
        ];
        return { output: `${lines.join("\n")}\n\n<details><summary>JSON</summary>\n\n\`\`\`json\n${JSON.stringify(content, null, 1)}\n\`\`\`\n</details>` };
      });
    }
  }
}

// ───────────────────────────── Report ─────────────────────────────

function report(): string {
  const date = new Date().toISOString().slice(0, 16).replace("T", " ");
  const out = [
    `# AI model comparison (${date} UTC)`,
    "",
    `Models: ${models.join(", ")}. Costs are estimates from each call's tokens and the prices in backendConfig.ai.prices (Gemini 3.x Flash at its 2027 prices).`,
    "",
    "## Summary (average per run)",
    "",
    "| Task | Model | Runs OK | Rules broken | Input tokens | Output tokens | Cost | Per 100 | Time |",
    "|---|---|---|---|---|---|---|---|---|",
  ];
  for (const task of tasks) {
    for (const model of models) {
      const group = runs.filter((run) => run.task === task && run.model === model);
      if (!group.length) continue;
      const calls = group.flatMap((run) => run.calls);
      const avg = (value: number) => value / group.length;
      const cost = avg(sum(calls, "costUsd"));
      const violations = group.some((run) => run.violations !== undefined) ? String(group.reduce((total, run) => total + (run.violations ?? 0), 0)) : "–";
      out.push(`| ${task} | ${model} | ${group.filter((run) => run.ok).length}/${group.length} | ${violations} | ${Math.round(avg(sum(calls, "inputTokens")))} | ${Math.round(avg(sum(calls, "outputTokens")))} | $${cost.toFixed(4)} | $${(cost * 100).toFixed(2)} | ${(avg(sum(calls, "ms")) / 1000).toFixed(1)} s |`);
    }
  }
  out.push("", `Prices used (USD per million tokens, input / output): ${models.map((model) => `${model} ${aiPrice(model).input} / ${aiPrice(model).output}`).join(" · ")}`);
  for (const task of tasks) {
    const taskRuns = runs.filter((run) => run.task === task);
    if (!taskRuns.length) continue;
    out.push("", `## ${task}`);
    for (const sample of [...new Set(taskRuns.map((run) => run.sample))]) {
      out.push("", `### ${sample}`);
      for (const run of taskRuns.filter((item) => item.sample === sample)) {
        out.push("", `#### ${run.model}${run.ok ? "" : " — ÉCHEC"}`, "", run.ok ? run.output : `Erreur : ${run.error}`);
      }
    }
  }
  return `${out.join("\n")}\n`;
}

async function main() {
  if (config.ai.provider !== "gemini") throw new Error(`AI_PROVIDER is "${config.ai.provider}": the comparison needs the real provider`);
  console.log(`Models: ${models.join(", ")} · tasks: ${tasks.join(", ")} · samples: ${samples}`);
  if (tasks.includes("generate")) await compareGenerate();
  if (tasks.includes("translate")) await compareTranslate();
  if (tasks.includes("extract")) await compareExtract();
  if (tasks.includes("parse")) await compareParse();
  const dir = join(process.cwd(), "data/ai-compare");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.md`);
  writeFileSync(file, report());
  const total = runs.reduce((value, run) => value + sum(run.calls, "costUsd"), 0);
  console.log(`\nReport: ${file}\nEstimated cost of this comparison: $${total.toFixed(3)}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
