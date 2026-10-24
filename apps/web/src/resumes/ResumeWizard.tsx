import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, FilePlus2, Loader2, Mail, Plus, Search, Sparkles, Target, Trash2, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { PolishLinesResponse, SuggestedSkillsResponse, WriteSummaryResponse } from "@job/shared";
import { api } from "../api/client";
import { useDebounced } from "../lib/use-debounced";
import { track } from "../lib/analytics";
import { errorMessage } from "../lib/errors";
import { toast } from "../lib/toast";
import { useTabsStore } from "../tabs/store";
import { useWorkspace } from "../tabs/workspace";
import type { TabViewProps } from "../views/registry";
import { draftToContent, emptyExperience, emptyStudy, filled, freshDraft, lines, loadDraft, STEPS, STORAGE_KEY, type Draft, type Experience, type Study } from "./draft";
import { newId } from "./fields";
import { useCreateResume } from "./queries";

// Creating a resume from scratch, step by step (FEATURE R7, /creer-mon-cv): you, your
// experience (in your own words, reworded by the AI on request), your studies, skills (the
// ones employers ask for the job you look for, from MonPoste's offers) and languages, a
// profile summary (written by the AI on request). Saved as a resume at the end; the draft
// stays in this browser meanwhile.

const input = "h-9 rounded-control border border-border bg-bg px-2.5 text-sm outline-none focus:border-accent";

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-xs font-medium text-fg-muted">{label}</span>
      {children}
      {hint && <span className="text-xs text-fg-subtle">{hint}</span>}
    </label>
  );
}

export default function ResumeWizard({ tab }: TabViewProps) {
  const { t } = useTranslation();
  const { open } = useWorkspace();
  const [draft, setDraft] = useState<Draft>(loadDraft);
  const [done, setDone] = useState(false);
  const create = useCreateResume();
  const set = (change: Partial<Draft>) => setDraft((current) => ({ ...current, ...change }));

  useEffect(() => track("resume_wizard_open"), []);
  // The draft survives a reload; unsaved work marks the tab.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
    } catch {
      // No storage.
    }
    useTabsStore.getState().update(tab.key, { dirty: !done && !!draft.name.trim() });
  }, [draft, done, tab.key]);

  const step = STEPS[draft.step];
  const canGoOn = step !== "you" || (draft.name.trim().length > 1 && draft.title.trim().length > 1);
  const finish = () =>
    create.mutate(
      { language: draft.language, content: draftToContent(draft), name: `${draft.language === "fr" ? "CV" : "Resume"} – ${draft.title.trim()}`.slice(0, 100) },
      {
        onSuccess: () => {
          track("resume_wizard_done");
          try {
            localStorage.removeItem(STORAGE_KEY);
          } catch {
            // No storage.
          }
          setDone(true);
        },
        onError: (error) => toast(errorMessage(t, error), "error"),
      },
    );

  if (done) {
    const next = "flex items-center gap-2 rounded-box border border-border px-4 py-3 text-left text-sm transition-colors hover:bg-hover";
    return (
      <div className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-10 sm:px-8">
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
          <Check size={20} className="text-success" /> {t("wizard.ready")}
        </h1>
        <p className="text-sm text-fg-muted">{t("wizard.readyText")}</p>
        <button type="button" onClick={() => open({ kind: "tailor" })} className={next}>
          <Target size={16} className="text-accent" /> {t("wizard.nextTailor")}
        </button>
        <button type="button" onClick={() => open({ kind: "write-letter" })} className={next}>
          <Mail size={16} className="text-accent" /> {t("wizard.nextLetter")}
        </button>
        <button type="button" onClick={() => open({ kind: "resumes" })} className={next}>
          <FilePlus2 size={16} className="text-accent" /> {t("wizard.nextEdit")}
        </button>
        <p className="flex items-center gap-2 text-sm text-fg-muted">
          <Search size={14} /> {t("welcome.searchHint")}
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5 px-4 py-6 sm:px-8 sm:py-8">
      <header className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
          <FilePlus2 size={20} className="text-accent" /> {t("wizard.title")}
        </h1>
        <p className="text-sm text-fg-muted">{t("wizard.intro")}</p>
      </header>

      <ol className="flex flex-wrap gap-1.5" aria-label={t("wizard.title")}>
        {STEPS.map((name, index) => (
          <li key={name}>
            <button
              type="button"
              aria-current={index === draft.step ? "step" : undefined}
              disabled={index > draft.step && !canGoOn}
              onClick={() => set({ step: index })}
              className={`flex h-7 items-center gap-1.5 rounded-full px-3 text-xs transition-colors ${index === draft.step ? "bg-accent text-accent-fg" : index < draft.step ? "bg-accent-soft text-accent" : "bg-hover text-fg-muted"}`}
            >
              {index < draft.step ? <Check size={12} /> : <span>{index + 1}</span>} {t(`wizard.steps.${name}`)}
            </button>
          </li>
        ))}
      </ol>

      <section className="flex flex-col gap-4 rounded-box border border-border bg-surface p-5">
        {step === "you" && <YouStep draft={draft} set={set} />}
        {step === "experience" && <ExperienceStep draft={draft} set={set} />}
        {step === "education" && <EducationStep draft={draft} set={set} />}
        {step === "skills" && <SkillsStep draft={draft} set={set} />}
        {step === "summary" && <SummaryStep draft={draft} set={set} />}
      </section>

      <div className="flex items-center gap-2">
        {draft.step > 0 && (
          <button type="button" onClick={() => set({ step: draft.step - 1 })} className="flex h-9 items-center gap-1.5 rounded-control px-3 text-sm text-fg-muted hover:bg-hover hover:text-fg">
            <ArrowLeft size={15} /> {t("wizard.back")}
          </button>
        )}
        <span className="flex-1" />
        {draft.step < STEPS.length - 1 ? (
          <button type="button" disabled={!canGoOn} onClick={() => set({ step: draft.step + 1 })} className="flex h-9 items-center gap-1.5 rounded-control bg-accent px-4 text-sm font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-50">
            {t("wizard.next")} <ArrowRight size={15} />
          </button>
        ) : (
          <button type="button" disabled={create.isPending} onClick={finish} className="flex h-9 items-center gap-1.5 rounded-control bg-accent px-4 text-sm font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-50">
            {create.isPending ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} {t("wizard.finish")}
          </button>
        )}
      </div>
      {draft.step === 0 && (
        <button
          type="button"
          onClick={() => {
            setDraft(freshDraft());
          }}
          className="self-start text-xs text-fg-subtle hover:text-fg"
        >
          {t("wizard.restart")}
        </button>
      )}
    </div>
  );
}

type StepProps = { draft: Draft; set: (change: Partial<Draft>) => void };

function YouStep({ draft, set }: StepProps) {
  const { t } = useTranslation();
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("wizard.name")}>
          <input autoFocus value={draft.name} onChange={(event) => set({ name: event.target.value })} autoComplete="name" className={input} />
        </Field>
        <Field label={t("wizard.target")} hint={t("wizard.targetHint")}>
          <input value={draft.title} onChange={(event) => set({ title: event.target.value })} placeholder={t("wizard.targetPlaceholder")} className={input} />
        </Field>
        <Field label={t("wizard.city")}>
          <input value={draft.city} onChange={(event) => set({ city: event.target.value })} autoComplete="address-level2" className={input} />
        </Field>
        <Field label={t("wizard.resumeLanguage")}>
          <select value={draft.language} onChange={(event) => set({ language: event.target.value as "fr" | "en" })} className={input}>
            <option value="fr">Français</option>
            <option value="en">English</option>
          </select>
        </Field>
        <Field label={t("wizard.email")}>
          <input type="email" value={draft.email} onChange={(event) => set({ email: event.target.value })} autoComplete="email" className={input} />
        </Field>
        <Field label={t("wizard.phone")}>
          <input type="tel" value={draft.phone} onChange={(event) => set({ phone: event.target.value })} autoComplete="tel" className={input} />
        </Field>
      </div>
    </>
  );
}

function Dates({ item, onChange, currentLabel }: { item: { start: string; end: string; current: boolean }; onChange: (change: Partial<{ start: string; end: string; current: boolean }>) => void; currentLabel: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-end gap-3">
      <Field label={t("wizard.start")}>
        <input type="month" value={item.start} onChange={(event) => onChange({ start: event.target.value })} className={input} />
      </Field>
      {!item.current && (
        <Field label={t("wizard.end")}>
          <input type="month" value={item.end} min={item.start || undefined} onChange={(event) => onChange({ end: event.target.value })} className={input} />
        </Field>
      )}
      <label className="flex h-9 items-center gap-2 text-sm">
        <input type="checkbox" className="accent-[var(--accent)]" checked={item.current} onChange={(event) => onChange({ current: event.target.checked, ...(event.target.checked && { end: "" }) })} />
        {currentLabel}
      </label>
    </div>
  );
}

function ExperienceStep({ draft, set }: StepProps) {
  const { t } = useTranslation();
  const update = (id: string, change: Partial<Experience>) => set({ experiences: draft.experiences.map((job) => (job.id === id ? { ...job, ...change } : job)) });
  const polish = useMutation({ mutationFn: (job: Experience) => api<PolishLinesResponse>("POST", "/api/resume-help/polish", { body: { language: draft.language, jobTitle: job.jobTitle, company: job.company || null, lines: lines(job.lines) } }) });
  const [polishing, setPolishing] = useState<string | null>(null);
  return (
    <>
      <p className="text-sm text-fg-muted">{t("wizard.experienceIntro")}</p>
      {draft.experiences.map((job, index) => (
        <div key={job.id} className="flex flex-col gap-3 rounded-box border border-border p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-fg-subtle">{t("wizard.experienceNumber", { number: index + 1 })}</span>
            <button type="button" aria-label={t("wizard.remove")} onClick={() => set({ experiences: draft.experiences.filter((item) => item.id !== job.id) })} className="flex size-7 items-center justify-center rounded-control text-fg-subtle hover:bg-hover hover:text-danger">
              <Trash2 size={14} />
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("wizard.jobTitle")}>
              <input value={job.jobTitle} onChange={(event) => update(job.id, { jobTitle: event.target.value })} placeholder={t("wizard.jobTitlePlaceholder")} className={input} />
            </Field>
            <Field label={t("wizard.company")}>
              <input value={job.company} onChange={(event) => update(job.id, { company: event.target.value })} className={input} />
            </Field>
          </div>
          <Dates item={job} onChange={(change) => update(job.id, change)} currentLabel={t("wizard.currentJob")} />
          <Field label={t("wizard.tasks")} hint={t("wizard.tasksHint")}>
            <textarea value={job.lines} onChange={(event) => update(job.id, { lines: event.target.value })} placeholder={t("wizard.tasksPlaceholder")} className="min-h-28 rounded-control border border-border bg-bg px-2.5 py-2 text-sm leading-relaxed outline-none focus:border-accent" />
          </Field>
          <button
            type="button"
            disabled={!job.jobTitle.trim() || lines(job.lines).length === 0 || polish.isPending}
            onClick={() => {
              setPolishing(job.id);
              polish.mutate(job, {
                onSuccess: (result) => {
                  update(job.id, { lines: result.lines.join("\n") });
                  track("resume_wizard_polish");
                },
                onError: (error) => toast(errorMessage(t, error), "error"),
                onSettled: () => setPolishing(null),
              });
            }}
            className="flex h-8 items-center gap-1.5 self-start rounded-control border border-border px-3 text-sm transition-colors hover:bg-hover disabled:opacity-50"
          >
            {polishing === job.id ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} className="text-accent" />} {t("wizard.polish")}
          </button>
        </div>
      ))}
      <button type="button" onClick={() => set({ experiences: [...draft.experiences, emptyExperience()] })} className="flex h-8 items-center gap-1.5 self-start rounded-control px-3 text-sm text-accent hover:bg-accent-soft">
        <Plus size={15} /> {t("wizard.addExperience")}
      </button>
    </>
  );
}

function EducationStep({ draft, set }: StepProps) {
  const { t } = useTranslation();
  const update = (id: string, change: Partial<Study>) => set({ studies: draft.studies.map((study) => (study.id === id ? { ...study, ...change } : study)) });
  return (
    <>
      <p className="text-sm text-fg-muted">{t("wizard.educationIntro")}</p>
      {draft.studies.map((study, index) => (
        <div key={study.id} className="flex flex-col gap-3 rounded-box border border-border p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-fg-subtle">{t("wizard.studyNumber", { number: index + 1 })}</span>
            <button type="button" aria-label={t("wizard.remove")} onClick={() => set({ studies: draft.studies.filter((item) => item.id !== study.id) })} className="flex size-7 items-center justify-center rounded-control text-fg-subtle hover:bg-hover hover:text-danger">
              <Trash2 size={14} />
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("wizard.degree")}>
              <input value={study.degree} onChange={(event) => update(study.id, { degree: event.target.value })} placeholder={t("wizard.degreePlaceholder")} className={input} />
            </Field>
            <Field label={t("wizard.institution")}>
              <input value={study.institution} onChange={(event) => update(study.id, { institution: event.target.value })} className={input} />
            </Field>
          </div>
          <Dates item={study} onChange={(change) => update(study.id, change)} currentLabel={t("wizard.currentStudy")} />
        </div>
      ))}
      <button type="button" onClick={() => set({ studies: [...draft.studies, emptyStudy()] })} className="flex h-8 items-center gap-1.5 self-start rounded-control px-3 text-sm text-accent hover:bg-accent-soft">
        <Plus size={15} /> {t("wizard.addStudy")}
      </button>
    </>
  );
}

function SkillsStep({ draft, set }: StepProps) {
  const { t } = useTranslation();
  const [typed, setTyped] = useState("");
  const title = useDebounced(draft.title.trim(), 300);
  const suggested = useQuery({
    queryKey: ["resume-help", "skills", title, draft.language],
    queryFn: ({ signal }) => api<SuggestedSkillsResponse>("GET", `/api/resume-help/skills?title=${encodeURIComponent(title)}&language=${draft.language}`, { signal }),
    enabled: title.length > 1,
    staleTime: 3600_000,
  });
  const has = (name: string) => draft.skills.some((skill) => skill.toLowerCase() === name.toLowerCase());
  const add = (name: string) => {
    const clean = name.trim();
    if (clean && !has(clean)) set({ skills: [...draft.skills, clean] });
  };
  const offered = (suggested.data?.skills ?? []).filter((name) => !has(name));
  const updateLanguage = (id: string, change: Partial<{ language: string; level: string }>) => set({ languages: draft.languages.map((item) => (item.id === id ? { ...item, ...change } : item)) });
  return (
    <>
      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium text-fg-muted">{t("wizard.skills")}</span>
        <div className="flex flex-wrap gap-1.5">
          {draft.skills.map((skill) => (
            <span key={skill} className="flex items-center gap-1 rounded-full bg-accent-soft py-0.5 pr-1 pl-2.5 text-sm text-accent">
              {skill}
              <button type="button" aria-label={t("wizard.remove")} onClick={() => set({ skills: draft.skills.filter((item) => item !== skill) })} className="flex size-5 items-center justify-center rounded-full hover:bg-accent/15">
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            add(typed);
            setTyped("");
          }}
          className="flex gap-2"
        >
          <input value={typed} onChange={(event) => setTyped(event.target.value)} placeholder={t("wizard.skillPlaceholder")} className={`${input} flex-1`} />
          <button type="submit" disabled={!typed.trim()} className="h-9 rounded-control border border-border px-3 text-sm hover:bg-hover disabled:opacity-50">
            {t("wizard.add")}
          </button>
        </form>
      </div>
      {offered.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-xs text-fg-muted">{t("wizard.suggested", { title: draft.title })}</span>
          <div className="flex flex-wrap gap-1.5">
            {offered.map((name) => (
              <button key={name} type="button" onClick={() => add(name)} className="flex items-center gap-1 rounded-full border border-border px-2.5 py-0.5 text-sm transition-colors hover:border-accent hover:bg-accent-soft">
                <Plus size={12} /> {name}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium text-fg-muted">{t("wizard.languages")}</span>
        {draft.languages.map((item) => (
          <div key={item.id} className="flex gap-2">
            <input value={item.language} onChange={(event) => updateLanguage(item.id, { language: event.target.value })} placeholder={t("wizard.languagePlaceholder")} className={`${input} flex-1`} />
            <select value={item.level} onChange={(event) => updateLanguage(item.id, { level: event.target.value })} className={input}>
              {(t("wizard.levels", { returnObjects: true }) as string[]).map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>
            <button type="button" aria-label={t("wizard.remove")} onClick={() => set({ languages: draft.languages.filter((other) => other.id !== item.id) })} className="flex size-9 items-center justify-center rounded-control text-fg-subtle hover:bg-hover hover:text-danger">
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        <button type="button" onClick={() => set({ languages: [...draft.languages, { id: newId(), language: "", level: (t("wizard.levels", { returnObjects: true }) as string[])[2] }] })} className="flex h-8 items-center gap-1.5 self-start rounded-control px-3 text-sm text-accent hover:bg-accent-soft">
          <Plus size={15} /> {t("wizard.addLanguage")}
        </button>
      </div>
    </>
  );
}

function SummaryStep({ draft, set }: StepProps) {
  const { t } = useTranslation();
  const write = useMutation({
    mutationFn: () =>
      api<WriteSummaryResponse>("POST", "/api/resume-help/summary", {
        body: {
          language: draft.language,
          targetTitle: draft.title.trim(),
          experiences: draft.experiences.filter((job) => job.jobTitle.trim()).map((job) => ({ jobTitle: job.jobTitle.trim(), company: filled(job.company), lines: lines(job.lines) })),
          education: draft.studies.filter((study) => study.degree.trim()).map((study) => ({ degree: study.degree.trim(), institution: filled(study.institution), current: study.current })),
          skills: draft.skills,
        },
      }),
  });
  return (
    <>
      <p className="text-sm text-fg-muted">{t("wizard.summaryIntro")}</p>
      <textarea value={draft.summary} onChange={(event) => set({ summary: event.target.value })} placeholder={t("wizard.summaryPlaceholder")} maxLength={600} className="min-h-28 rounded-control border border-border bg-bg px-2.5 py-2 text-sm leading-relaxed outline-none focus:border-accent" />
      <button
        type="button"
        disabled={write.isPending}
        onClick={() =>
          write.mutate(undefined, {
            onSuccess: (result) => {
              set({ summary: result.summary });
              track("resume_wizard_summary");
            },
            onError: (error) => toast(errorMessage(t, error), "error"),
          })
        }
        className="flex h-8 items-center gap-1.5 self-start rounded-control border border-border px-3 text-sm transition-colors hover:bg-hover disabled:opacity-50"
      >
        {write.isPending ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} className="text-accent" />} {t("wizard.writeSummary")}
      </button>
      <p className="text-xs text-fg-subtle">{t("wizard.finishHint")}</p>
    </>
  );
}
