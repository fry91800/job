import { AlertTriangle, Check, Languages, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { RESUME_LANGUAGES, resumeContentSchema, type ResumeContent, type ResumeDetail } from "@job/shared";
import { errorMessage } from "../lib/errors";
import { toast } from "../lib/toast";
import { useTabsStore } from "../tabs/store";
import { DateField, EditorContext, ItemList, newId, Section, TagsField, TextField } from "./fields";
import { useResume, useSaveResume, useTranslateResume } from "./queries";

// The structured form over a resume (FEATURE R3), checked with the API's schema before
// saving. Unsaved changes mark the tab (closing asks first). On a translation (T1) every
// translated field shows its original and can be translated again; "Mark as reviewed" is
// kept in the browser only.

type Draft = { name: string; language: string; content: ResumeContent };

const REVIEWED_KEY = "job.reviewedTranslations";
function reviewed(id: string): boolean {
  try {
    return (JSON.parse(localStorage.getItem(REVIEWED_KEY) ?? "[]") as string[]).includes(id);
  } catch {
    return false;
  }
}
function markReviewed(id: string) {
  try {
    const list = JSON.parse(localStorage.getItem(REVIEWED_KEY) ?? "[]") as string[];
    localStorage.setItem(REVIEWED_KEY, JSON.stringify([...list.filter((item) => item !== id), id].slice(-200)));
  } catch {
    // Shown again next time.
  }
}

function useIssueText() {
  const { t } = useTranslation();
  return (issue: { code: string; message: string }) => {
    if (issue.message.includes("YYYY")) return t("resume.errors.date");
    if (issue.message.includes("current job")) return t("resume.errors.currentEnd");
    if (issue.message.includes("Start date")) return t("resume.errors.dateOrder");
    if (issue.code === "too_small") return t("resume.errors.required");
    if (issue.code === "too_big") return t("resume.errors.tooLong");
    return issue.message;
  };
}

function Banner({ tone, children }: { tone: "info" | "warning"; children: React.ReactNode }) {
  return (
    <div className={`flex items-start gap-2 rounded-box border px-3 py-2 text-sm ${tone === "warning" ? "border-warning/40 bg-warning/10" : "border-accent/30 bg-accent-soft"}`}>
      {children}
    </div>
  );
}

export function ResumeEditor({ resume, tabKey, justImported, onOpen }: { resume: ResumeDetail; tabKey: string; justImported: boolean; onOpen: (id: string) => void }) {
  const { t } = useTranslation();
  const issueText = useIssueText();
  const save = useSaveResume(resume.id);
  const translate = useTranslateResume();
  const source = useResume(resume.translatedFrom?.id ?? null).data ?? null;
  const [draft, setDraft] = useState<Draft>({ name: resume.name, language: resume.language, content: resume.content });
  const [errors, setErrors] = useState(new Map<string, string>());
  const [isReviewed, setReviewed] = useState(() => reviewed(resume.id));
  const saved = useMemo(() => JSON.stringify({ name: resume.name, language: resume.language, content: resume.content }), [resume]);
  const dirty = JSON.stringify(draft) !== saved;

  // The tab shows unsaved changes (FRONTEND.md §2.2).
  useEffect(() => {
    useTabsStore.getState().update(tabKey, { dirty });
    return () => useTabsStore.getState().update(tabKey, { dirty: false });
  }, [dirty, tabKey]);

  const content = draft.content;
  const set = (change: Partial<ResumeContent>) => setDraft((current) => ({ ...current, content: { ...current.content, ...change } }));
  const basics = (change: Partial<ResumeContent["basics"]>) => set({ basics: { ...content.basics, ...change } });
  const original = source?.content;
  const byId = <T extends { id: string }>(items: T[] | undefined, id: string) => items?.find((item) => item.id === id);

  const onSave = async () => {
    const check = resumeContentSchema.safeParse(content);
    if (!check.success) {
      setErrors(new Map(check.error.issues.map((issue) => [issue.path.join("."), issueText(issue)])));
      toast(t("resume.fixErrors"), "error");
      return;
    }
    setErrors(new Map());
    try {
      const result = await save.mutateAsync({ name: draft.name.trim() || resume.name, language: draft.language, content });
      setDraft({ name: result.name, language: result.language, content: result.content });
      toast(t("resume.saved"));
    } catch (error) {
      toast(errorMessage(t, error), "error");
    }
  };

  // Ctrl+S / Cmd+S saves.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "s" && dirty) {
        event.preventDefault();
        void onSave();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <EditorContext.Provider value={{ errors, resumeId: resume.id, isTranslation: !!resume.translatedFrom }}>
      <div className="flex flex-col gap-6">
        <div className="sticky top-0 z-10 -mx-4 flex flex-wrap items-center gap-2 border-b border-border bg-bg/90 px-4 py-3 sm:-mx-8 sm:px-8 backdrop-blur">
          <input
            aria-label={t("resume.name")}
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            className="min-w-0 flex-1 basis-full rounded-control bg-transparent px-1 text-lg font-semibold outline-none hover:bg-hover focus:bg-hover sm:basis-auto"
          />
          <select
            aria-label={t("resume.language")}
            value={draft.language}
            onChange={(event) => setDraft({ ...draft, language: event.target.value })}
            className="h-8 rounded-control border border-border bg-bg px-2 text-sm outline-none focus:border-accent"
          >
            {RESUME_LANGUAGES.map((language) => (
              <option key={language} value={language}>
                {t(`resume.languages.${language}`)}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!dirty || save.isPending}
            onClick={onSave}
            className="flex h-8 items-center gap-1.5 rounded-control bg-accent px-3 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-50"
          >
            {save.isPending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            {dirty ? t("resume.save") : t("resume.upToDate")}
          </button>
        </div>

        {justImported && (
          <Banner tone="info">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-accent" /> {t("resume.checkImport")}
          </Banner>
        )}
        {resume.translatedFrom && !isReviewed && (
          <Banner tone="info">
            <Languages size={16} className="mt-0.5 shrink-0 text-accent" />
            <span className="flex-1">{t("resume.checkTranslation", { name: resume.translatedFrom.name })}</span>
            <button
              type="button"
              onClick={() => {
                markReviewed(resume.id);
                setReviewed(true);
              }}
              className="shrink-0 font-medium text-accent hover:underline"
            >
              {t("resume.markReviewed")}
            </button>
          </Banner>
        )}
        {resume.translatedFrom?.changedSinceTranslation && (
          <Banner tone="warning">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warning" />
            <span className="flex-1">{t("resume.sourceChanged")}</span>
            <button
              type="button"
              disabled={translate.isPending}
              onClick={() =>
                translate.mutate(
                  { id: resume.translatedFrom!.id, language: resume.language as "fr" | "en", force: true },
                  { onSuccess: (created) => onOpen(created.id), onError: (error) => toast(errorMessage(t, error), "error") },
                )
              }
              className="flex shrink-0 items-center gap-1 font-medium text-accent hover:underline disabled:opacity-60"
            >
              {translate.isPending && <Loader2 size={13} className="animate-spin" />}
              {t("resume.translateAgain")}
            </button>
          </Banner>
        )}

        <Section title={t("resume.sections.basics")}>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label={t("resume.fields.fullName")} value={content.basics.fullName} onChange={(value) => basics({ fullName: value ?? "" })} errorPath="basics.fullName" />
            <TextField
              label={t("resume.fields.title")}
              value={content.basics.title}
              onChange={(value) => basics({ title: value })}
              errorPath="basics.title"
              translation={{ path: "basics.title", original: original?.basics.title }}
            />
            <TextField label={t("resume.fields.email")} value={content.basics.email} onChange={(value) => basics({ email: value })} errorPath="basics.email" />
            <TextField label={t("resume.fields.phone")} value={content.basics.phone} onChange={(value) => basics({ phone: value })} errorPath="basics.phone" />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {(["city", "region", "country"] as const).map((key) => (
              <TextField
                key={key}
                label={t(`resume.fields.${key}`)}
                value={content.basics.location?.[key] ?? null}
                onChange={(value) => {
                  const location = { city: null, region: null, country: null, ...content.basics.location, [key]: value };
                  basics({ location: location.city || location.region || location.country ? location : null });
                }}
              />
            ))}
          </div>
          <ItemList
            compact
            items={content.basics.links}
            onChange={(links) => basics({ links })}
            newItem={() => ({ id: newId(), label: "", url: "" })}
            addLabel={t("resume.add.link")}
            title={(link) => link.label}
          >
            {(link, index, update) => (
              <div className="grid gap-2 sm:grid-cols-[1fr_2fr]">
                <TextField label={t("resume.fields.linkLabel")} value={link.label} onChange={(value) => update({ label: value ?? "" })} errorPath={`basics.links.${index}.label`} />
                <TextField label={t("resume.fields.url")} value={link.url} onChange={(value) => update({ url: value ?? "" })} errorPath={`basics.links.${index}.url`} />
              </div>
            )}
          </ItemList>
        </Section>

        <Section title={t("resume.sections.summary")}>
          <TextField label={t("resume.sections.summary")} multiline value={content.summary} onChange={(summary) => set({ summary })} errorPath="summary" translation={{ path: "summary", original: original?.summary }} />
        </Section>

        <Section title={t("resume.sections.skills")}>
          <ItemList
            compact
            items={content.skills}
            onChange={(skills) => set({ skills })}
            newItem={() => ({ id: newId(), name: "", category: "technical" as const })}
            addLabel={t("resume.add.skill")}
            title={(skill) => skill.name}
          >
            {(skill, index, update) => (
              <div className="grid items-start gap-2 sm:grid-cols-[2fr_1fr]">
                <TextField
                  label={t("resume.fields.skill")}
                  value={skill.name}
                  onChange={(value) => update({ name: value ?? "" })}
                  errorPath={`skills.${index}.name`}
                  translation={skill.category === "soft" ? { path: `skills[id=${skill.id}].name`, original: byId(original?.skills, skill.id)?.name } : undefined}
                />
                <label className="flex flex-col gap-1 text-xs font-medium text-fg-muted">
                  {t("resume.fields.category")}
                  <select
                    value={skill.category}
                    onChange={(event) => update({ category: event.target.value as "technical" | "soft" })}
                    className="h-8 rounded-control border border-border bg-bg px-2 text-sm text-fg outline-none focus:border-accent"
                  >
                    <option value="technical">{t("resume.categories.technical")}</option>
                    <option value="soft">{t("resume.categories.soft")}</option>
                  </select>
                </label>
              </div>
            )}
          </ItemList>
        </Section>

        <Section title={t("resume.sections.workExperience")}>
          <ItemList
            items={content.workExperience}
            onChange={(workExperience) => set({ workExperience })}
            newItem={() => ({ id: newId(), jobTitle: "", company: "", location: null, startDate: null, endDate: null, isCurrent: false, responsibilities: [], technologies: [] })}
            addLabel={t("resume.add.job")}
            title={(job) => [job.jobTitle, job.company].filter(Boolean).join(" · ")}
          >
            {(job, index, update) => {
              const sourceJob = byId(original?.workExperience, job.id);
              return (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <TextField
                      label={t("resume.fields.jobTitle")}
                      value={job.jobTitle}
                      onChange={(value) => update({ jobTitle: value ?? "" })}
                      errorPath={`workExperience.${index}.jobTitle`}
                      translation={{ path: `workExperience[id=${job.id}].jobTitle`, original: sourceJob?.jobTitle }}
                    />
                    <TextField label={t("resume.fields.company")} value={job.company} onChange={(value) => update({ company: value ?? "" })} errorPath={`workExperience.${index}.company`} />
                    <TextField label={t("resume.fields.location")} value={job.location} onChange={(value) => update({ location: value })} />
                    <div className="grid grid-cols-2 gap-3">
                      <DateField label={t("resume.fields.start")} value={job.startDate} onChange={(value) => update({ startDate: value })} errorPath={`workExperience.${index}.startDate`} />
                      <DateField label={t("resume.fields.end")} value={job.endDate} onChange={(value) => update({ endDate: value })} errorPath={`workExperience.${index}.endDate`} disabled={job.isCurrent} />
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" className="accent-[var(--accent)]" checked={job.isCurrent} onChange={(event) => update({ isCurrent: event.target.checked, endDate: event.target.checked ? null : job.endDate })} />
                    {t("resume.fields.current")}
                  </label>
                  <span className="text-xs font-medium text-fg-muted">{t("resume.fields.responsibilities")}</span>
                  <ItemList
                    compact
                    items={job.responsibilities}
                    onChange={(responsibilities) => update({ responsibilities })}
                    newItem={() => ({ id: newId(), text: "" })}
                    addLabel={t("resume.add.responsibility")}
                    title={(item) => item.text}
                  >
                    {(item, itemIndex, updateItem) => (
                      <TextField
                        label={t("resume.fields.responsibility", { number: itemIndex + 1 })}
                        hideLabel
                        multiline
                        value={item.text}
                        onChange={(value) => updateItem({ text: value ?? "" })}
                        errorPath={`workExperience.${index}.responsibilities.${itemIndex}.text`}
                        translation={{ path: `workExperience[id=${job.id}].responsibilities[id=${item.id}].text`, original: byId(sourceJob?.responsibilities, item.id)?.text }}
                      />
                    )}
                  </ItemList>
                  <TagsField label={t("resume.fields.technologies")} values={job.technologies} onChange={(technologies) => update({ technologies })} />
                </>
              );
            }}
          </ItemList>
        </Section>

        <Section title={t("resume.sections.projects")}>
          <ItemList
            items={content.projects}
            onChange={(projects) => set({ projects })}
            newItem={() => ({ id: newId(), name: "", description: null, technologies: [], link: null, highlights: [] })}
            addLabel={t("resume.add.project")}
            title={(project) => project.name}
          >
            {(project, index, update) => {
              const sourceProject = byId(original?.projects, project.id);
              return (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <TextField label={t("resume.fields.projectName")} value={project.name} onChange={(value) => update({ name: value ?? "" })} errorPath={`projects.${index}.name`} />
                    <TextField label={t("resume.fields.url")} value={project.link} onChange={(value) => update({ link: value })} />
                  </div>
                  <TextField
                    label={t("resume.fields.description")}
                    multiline
                    value={project.description}
                    onChange={(value) => update({ description: value })}
                    translation={{ path: `projects[id=${project.id}].description`, original: sourceProject?.description }}
                  />
                  <span className="text-xs font-medium text-fg-muted">{t("resume.fields.highlights")}</span>
                  <ItemList compact items={project.highlights} onChange={(highlights) => update({ highlights })} newItem={() => ({ id: newId(), text: "" })} addLabel={t("resume.add.highlight")} title={(item) => item.text}>
                    {(item, itemIndex, updateItem) => (
                      <TextField
                        label={t("resume.fields.highlight", { number: itemIndex + 1 })}
                        hideLabel
                        multiline
                        value={item.text}
                        onChange={(value) => updateItem({ text: value ?? "" })}
                        errorPath={`projects.${index}.highlights.${itemIndex}.text`}
                        translation={{ path: `projects[id=${project.id}].highlights[id=${item.id}].text`, original: byId(sourceProject?.highlights, item.id)?.text }}
                      />
                    )}
                  </ItemList>
                  <TagsField label={t("resume.fields.technologies")} values={project.technologies} onChange={(technologies) => update({ technologies })} />
                </>
              );
            }}
          </ItemList>
        </Section>

        <Section title={t("resume.sections.education")}>
          <ItemList
            items={content.education}
            onChange={(education) => set({ education })}
            newItem={() => ({ id: newId(), degree: "", institution: "", location: null, startDate: null, endDate: null, description: null })}
            addLabel={t("resume.add.education")}
            title={(item) => [item.degree, item.institution].filter(Boolean).join(" · ")}
          >
            {(item, index, update) => {
              const sourceItem = byId(original?.education, item.id);
              return (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <TextField
                      label={t("resume.fields.degree")}
                      value={item.degree}
                      onChange={(value) => update({ degree: value ?? "" })}
                      errorPath={`education.${index}.degree`}
                      translation={{ path: `education[id=${item.id}].degree`, original: sourceItem?.degree }}
                    />
                    <TextField label={t("resume.fields.institution")} value={item.institution} onChange={(value) => update({ institution: value ?? "" })} errorPath={`education.${index}.institution`} />
                    <TextField label={t("resume.fields.location")} value={item.location} onChange={(value) => update({ location: value })} />
                    <div className="grid grid-cols-2 gap-3">
                      <DateField label={t("resume.fields.start")} value={item.startDate} onChange={(value) => update({ startDate: value })} errorPath={`education.${index}.startDate`} />
                      <DateField label={t("resume.fields.end")} value={item.endDate} onChange={(value) => update({ endDate: value })} errorPath={`education.${index}.endDate`} />
                    </div>
                  </div>
                  <TextField
                    label={t("resume.fields.description")}
                    multiline
                    value={item.description}
                    onChange={(value) => update({ description: value })}
                    translation={{ path: `education[id=${item.id}].description`, original: sourceItem?.description }}
                  />
                </>
              );
            }}
          </ItemList>
        </Section>

        <Section title={t("resume.sections.languages")}>
          <ItemList compact items={content.languages} onChange={(languages) => set({ languages })} newItem={() => ({ id: newId(), language: "", level: null })} addLabel={t("resume.add.language")} title={(item) => item.language}>
            {(item, index, update) => (
              <div className="grid gap-2 sm:grid-cols-2">
                <TextField
                  label={t("resume.fields.language")}
                  value={item.language}
                  onChange={(value) => update({ language: value ?? "" })}
                  errorPath={`languages.${index}.language`}
                  translation={{ path: `languages[id=${item.id}].language`, original: byId(original?.languages, item.id)?.language }}
                />
                <TextField
                  label={t("resume.fields.level")}
                  value={item.level}
                  onChange={(value) => update({ level: value })}
                  translation={{ path: `languages[id=${item.id}].level`, original: byId(original?.languages, item.id)?.level }}
                />
              </div>
            )}
          </ItemList>
        </Section>

        <Section title={t("resume.sections.certifications")}>
          <ItemList
            compact
            items={content.certifications}
            onChange={(certifications) => set({ certifications })}
            newItem={() => ({ id: newId(), name: "", issuer: null, date: null })}
            addLabel={t("resume.add.certification")}
            title={(item) => item.name}
          >
            {(item, index, update) => (
              <div className="grid gap-2 sm:grid-cols-[2fr_1.5fr_1fr]">
                <TextField
                  label={t("resume.fields.certification")}
                  value={item.name}
                  onChange={(value) => update({ name: value ?? "" })}
                  errorPath={`certifications.${index}.name`}
                  translation={{ path: `certifications[id=${item.id}].name`, original: byId(original?.certifications, item.id)?.name }}
                />
                <TextField label={t("resume.fields.issuer")} value={item.issuer} onChange={(value) => update({ issuer: value })} />
                <DateField label={t("resume.fields.date")} value={item.date} onChange={(value) => update({ date: value })} errorPath={`certifications.${index}.date`} />
              </div>
            )}
          </ItemList>
        </Section>

        <Section title={t("resume.sections.interests")}>
          <TagsField label={t("resume.sections.interests")} values={content.interests} onChange={(interests) => set({ interests })} />
        </Section>
      </div>
    </EditorContext.Provider>
  );
}
