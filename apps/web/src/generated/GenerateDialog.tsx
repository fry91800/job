import * as Dialog from "@radix-ui/react-dialog";
import { Camera, Languages, Loader2, Sparkles, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { MODIFIER_SECTIONS, MODIFIER_STRENGTHS, type LanguageMismatchDetails, type ModifierStrength, type ResumeLanguage } from "@job/shared";
import { create } from "zustand";
import { ApiError } from "../api/client";
import { errorMessage } from "../lib/errors";
import { useResumes, useTranslateResume } from "../resumes/queries";
import { useTabsStore } from "../tabs/store";
import { useWorkspace } from "../tabs/workspace";
import { useGenerate, useSettings, useTemplates, type GenerateInput } from "./queries";

// Generating a resume for an offer (FEATURE M1): source resume, AI modifier and its
// strength (with the sections it modifies, S1), template. When the offer and the resume
// are in different languages: use a resume in the offer's language, translate first, or
// generate anyway.

export const useGenerateDialog = create<{ offer: { id: string; title: string } | null; open(offer: { id: string; title: string }): void; close(): void }>((set) => ({
  offer: null,
  open: (offer) => set({ offer }),
  close: () => set({ offer: null }),
}));

function Choice({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={`flex flex-col items-start gap-0.5 rounded-control border px-3 py-2 text-left text-sm transition-colors duration-150 ${selected ? "border-accent bg-accent-soft" : "border-border hover:bg-hover"}`}
    >
      {children}
    </button>
  );
}

function Form({ offerId, onDone }: { offerId: string; onDone: (generatedId: string) => void }) {
  const { t } = useTranslation();
  const { open } = useWorkspace();
  const settings = useSettings();
  const templates = useTemplates();
  const resumes = useResumes();
  const generate = useGenerate();
  const translate = useTranslateResume();
  const list = resumes.data?.results ?? [];
  const [resumeId, setResumeId] = useState<string | null>(null);
  const [modifierEnabled, setModifierEnabled] = useState(true);
  const [strength, setStrength] = useState<ModifierStrength>("medium");
  const [templateId, setTemplateId] = useState<number | null>(null);
  const [remember, setRemember] = useState(false);
  const [mismatch, setMismatch] = useState<LanguageMismatchDetails | null>(null);
  const [error, setError] = useState<unknown>(null);

  // Defaults: the selected resume and the user's settings.
  useEffect(() => {
    if (resumeId === null && list.length) setResumeId(list.find((item) => item.isSelected)?.id ?? list[0].id);
  }, [list, resumeId]);
  useEffect(() => {
    if (!settings.data) return;
    setModifierEnabled(settings.data.modifierEnabled);
    setStrength(settings.data.modifierStrength);
    setTemplateId(settings.data.templateId);
  }, [settings.data]);
  useEffect(() => {
    if (templateId === null && templates.data?.results[0]) setTemplateId(templates.data.results[0].id);
  }, [templates.data, templateId]);

  const run = async (change: Partial<GenerateInput> = {}) => {
    setError(null);
    try {
      const created = await generate.mutateAsync({
        offerId,
        resumeId: resumeId ?? undefined,
        templateId: templateId ?? undefined,
        modifierEnabled,
        modifierStrength: strength,
        remember,
        ...change,
      });
      onDone(created.id);
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "language_mismatch") setMismatch(caught.details as LanguageMismatchDetails);
      else setError(caught);
    }
  };

  const busy = generate.isPending || translate.isPending;
  const sections = settings.data?.modifierSectionsByStrength?.[strength];
  const language = (code: string) => t(`resume.languagesInText.${code}`, { defaultValue: code });

  if (resumes.data && list.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-fg-muted">{t("generate.needResume")}</p>
        <button type="button" onClick={() => open({ kind: "resumes" })} className="self-start rounded-control bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg hover:bg-accent-hover">
          {t("welcome.upload")}
        </button>
      </div>
    );
  }

  if (busy) {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <Loader2 size={24} className="animate-spin text-accent" />
        <p className="font-medium">{translate.isPending ? t("generate.translating") : modifierEnabled ? t("generate.working") : t("generate.rendering")}</p>
        <p className="text-sm text-fg-subtle">{t("generate.workingHint")}</p>
      </div>
    );
  }

  if (mismatch) {
    const alternative = list.find((item) => item.id === mismatch.alternativeResumeId);
    return (
      <div className="flex flex-col gap-3">
        <p className="flex items-start gap-2 text-sm">
          <Languages size={16} className="mt-0.5 shrink-0 text-accent" />
          {t("generate.mismatch", { offer: language(mismatch.offerLanguage), resume: language(mismatch.resumeLanguage) })}
        </p>
        {alternative && (
          <button type="button" onClick={() => void run({ resumeId: alternative.id })} className="rounded-control bg-accent px-3 py-2 text-left text-sm font-medium text-accent-fg hover:bg-accent-hover">
            {t("generate.useAlternative", { name: alternative.name })}
          </button>
        )}
        <button
          type="button"
          onClick={async () => {
            try {
              const translated = await translate.mutateAsync({ id: resumeId!, language: mismatch.offerLanguage as ResumeLanguage });
              setMismatch(null);
              setResumeId(translated.id);
              await run({ resumeId: translated.id });
            } catch (caught) {
              setMismatch(null);
              setError(caught);
            }
          }}
          className={`rounded-control px-3 py-2 text-left text-sm font-medium ${alternative ? "border border-border hover:bg-hover" : "bg-accent text-accent-fg hover:bg-accent-hover"}`}
        >
          {t("generate.translateFirst", { language: language(mismatch.offerLanguage) })}
          <span className="block text-xs font-normal opacity-80">{t("generate.translateFirstHint")}</span>
        </button>
        <button type="button" onClick={() => void run({ ignoreLanguageMismatch: true })} className="rounded-control border border-border px-3 py-2 text-left text-sm hover:bg-hover">
          {t("generate.anyway", { language: language(mismatch.resumeLanguage) })}
        </button>
        <button type="button" onClick={() => setMismatch(null)} className="self-start text-xs text-fg-muted hover:text-fg">
          {t("generate.back")}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-xs font-medium text-fg-muted">{t("generate.resume")}</span>
        <select value={resumeId ?? ""} onChange={(event) => setResumeId(event.target.value)} className="h-9 rounded-control border border-border bg-bg px-2 outline-none focus:border-accent">
          {list.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} ({item.language.toUpperCase()}){item.isSelected ? ` · ${t("resume.selected")}` : ""}
            </option>
          ))}
        </select>
      </label>

      <div className="flex flex-col gap-2">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" className="accent-[var(--accent)]" checked={modifierEnabled} onChange={(event) => setModifierEnabled(event.target.checked)} />
          {t("generate.modifier")}
        </label>
        {modifierEnabled ? (
          <div role="radiogroup" aria-label={t("generate.strength")} className="grid grid-cols-3 gap-2">
            {MODIFIER_STRENGTHS.map((value) => (
              <Choice key={value} selected={strength === value} onClick={() => setStrength(value)}>
                <span className="font-medium">{t(`generate.strengths.${value}`)}</span>
                <span className="text-xs text-fg-muted">{t(`generate.strengthHints.${value}`)}</span>
              </Choice>
            ))}
          </div>
        ) : (
          <p className="text-xs text-fg-muted">{t("generate.modifierOff")}</p>
        )}
        {modifierEnabled && sections && (
          <p className="text-xs text-fg-muted">
            {t("generate.modifies")}{" "}
            {MODIFIER_SECTIONS.filter((section) => sections[section])
              .map((section) => t(`resume.sections.${section}`))
              .join(", ")}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-fg-muted">{t("generate.template")}</span>
        <div role="radiogroup" className="grid grid-cols-2 gap-2">
          {templates.data?.results.map((template) => (
            <Choice key={template.id} selected={templateId === template.id} onClick={() => setTemplateId(template.id)}>
              <span className="flex items-center gap-1.5 font-medium">
                {template.name} {template.supportsPhoto && <Camera size={13} className="text-fg-subtle" aria-label={t("generate.withPhoto")} />}
              </span>
            </Choice>
          ))}
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-fg-muted">
        <input type="checkbox" className="accent-[var(--accent)]" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
        {t("generate.remember")}
      </label>

      {error !== null && (
        <p role="alert" className="rounded-control bg-danger/10 px-3 py-2 text-sm text-danger">
          {errorMessage(t, error)}
        </p>
      )}
      <button
        type="button"
        disabled={!resumeId}
        onClick={() => void run()}
        className="flex h-9 items-center justify-center gap-2 rounded-control bg-accent px-4 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-50"
      >
        <Sparkles size={15} /> {t("offer.generate")}
      </button>
    </div>
  );
}

export function GenerateDialog() {
  const { t } = useTranslation();
  const { offer, close } = useGenerateDialog();
  const { open, keep } = useWorkspace();
  return (
    <Dialog.Root open={offer !== null} onOpenChange={(value) => !value && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="animate-fade-in fixed inset-0 z-40 bg-overlay" />
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-4">
          <Dialog.Content className="animate-pop-in pointer-events-auto max-h-[calc(100vh-32px)] w-full max-w-[460px] overflow-y-auto rounded-box border border-border bg-surface p-6 shadow-float" aria-describedby={undefined}>
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Dialog.Title className="text-lg font-semibold tracking-tight">{t("offer.generate")}</Dialog.Title>
                <p className="truncate text-sm text-fg-muted">{offer?.title}</p>
              </div>
              <Dialog.Close className="flex size-7 shrink-0 items-center justify-center rounded-control text-fg-subtle transition-colors hover:bg-hover hover:text-fg" aria-label={t("tabs.close")}>
                <X size={16} />
              </Dialog.Close>
            </div>
            {offer && (
              <Form
                key={offer.id}
                offerId={offer.id}
                onDone={(generatedId) => {
                  // Generating keeps the offer's preview tab open (FRONTEND.md §2.2).
                  const offerTab = useTabsStore.getState().tabs.find((tab) => tab.key === `offer:${offer.id}`);
                  if (offerTab) keep(offerTab.key);
                  close();
                  open({ kind: "generated", id: generatedId });
                }}
              />
            )}
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
