import { Check, FileText, Loader2, Sparkles, Target } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { GenerateForm } from "../generated/GenerateDialog";
import { track } from "../lib/analytics";
import { useResumes } from "../resumes/queries";
import { UploadZone } from "../resumes/ResumesView";
import { useWorkspace } from "../tabs/workspace";
import { AddOfferFlow } from "./AddOfferView";

// "Adapter mon CV" (/adapter-mon-cv, SEO.md "Tool pages"): the three steps of a tailored
// resume on one screen, for visitors arriving from a search: the resume (pick one or
// upload), the offer (its address or text, checked), then the generation. Everything it
// uses exists elsewhere: the upload zone, the offer form, the generation form.

type Step = 1 | 2 | 3;

function StepCard({ number, title, done, current, summary, children }: { number: Step; title: string; done: boolean; current: boolean; summary?: ReactNode; children?: ReactNode }) {
  return (
    <section className={`rounded-box border p-4 ${current ? "border-accent/50 bg-surface" : "border-border"}`} aria-current={current ? "step" : undefined}>
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <span className={`flex size-6 items-center justify-center rounded-full text-xs ${done ? "bg-success/15 text-success" : current ? "bg-accent text-accent-fg" : "bg-hover text-fg-subtle"}`}>{done ? <Check size={14} /> : number}</span>
        {title}
      </h2>
      {done && summary && <div className="mt-2 pl-8 text-sm text-fg-muted">{summary}</div>}
      {current && <div className="mt-3 flex flex-col gap-3">{children}</div>}
    </section>
  );
}

export default function TailorView() {
  const { t } = useTranslation();
  const { open } = useWorkspace();
  const resumes = useResumes();
  const list = resumes.data?.results ?? [];
  const [resumeId, setResumeId] = useState<string | null>(null);
  const [offerId, setOfferId] = useState<string | null>(null);
  const [step, setStep] = useState<Step>(1);

  useEffect(() => track("tailor_open"), []);
  // The selected resume, else the first, is proposed.
  useEffect(() => {
    if (resumeId === null && list.length) setResumeId(list.find((item) => item.isSelected)?.id ?? list[0].id);
  }, [list, resumeId]);

  const chosen = list.find((item) => item.id === resumeId);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-6 sm:px-8 sm:py-8">
      <header className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
          <Target size={20} className="text-accent" /> {t("tailor.title")}
        </h1>
        <p className="text-sm text-fg-muted">{t("tailor.intro")}</p>
      </header>

      <StepCard number={1} title={t("tailor.resumeStep")} done={step > 1} current={step === 1} summary={chosen && <span className="flex items-center gap-1.5"><FileText size={14} /> {chosen.name}</span>}>
        {resumes.isPending ? (
          <Loader2 size={18} className="animate-spin text-accent" />
        ) : (
          <>
            {list.length > 0 && (
              <div role="radiogroup" aria-label={t("tailor.resumeStep")} className="flex flex-col gap-1.5">
                {list.map((item) => (
                  <label key={item.id} className={`flex cursor-pointer items-center gap-2 rounded-control border px-3 py-2 text-sm ${item.id === resumeId ? "border-accent bg-accent-soft" : "border-border hover:bg-hover"}`}>
                    <input type="radio" name="tailor-resume" className="accent-[var(--accent)]" checked={item.id === resumeId} onChange={() => setResumeId(item.id)} />
                    <span className="font-medium">{item.name}</span>
                    <span className="text-xs uppercase text-fg-subtle">{item.language}</span>
                  </label>
                ))}
              </div>
            )}
            <p className="text-xs text-fg-subtle">{list.length ? t("tailor.orUpload") : t("tailor.upload")}</p>
            <UploadZone
              onUploaded={(id) => {
                setResumeId(id);
                setStep(2);
              }}
            />
            {list.length > 0 && (
              <button type="button" disabled={!resumeId} onClick={() => setStep(2)} className="self-start rounded-control bg-accent px-4 py-1.5 text-sm font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-50">
                {t("tailor.next")}
              </button>
            )}
          </>
        )}
      </StepCard>

      <StepCard number={2} title={t("tailor.offerStep")} done={step > 2} current={step === 2} summary={t("tailor.offerDone")}>
        <p className="text-sm text-fg-muted">{t("tailor.offerHint")}</p>
        <AddOfferFlow
          onSaved={(id) => {
            setOfferId(id);
            setStep(3);
          }}
        />
        <button type="button" onClick={() => setStep(1)} className="self-start text-xs text-fg-muted hover:text-fg">
          {t("tailor.back")}
        </button>
      </StepCard>

      <StepCard number={3} title={t("tailor.generateStep")} done={false} current={step === 3}>
        {offerId && (
          <GenerateForm
            offerId={offerId}
            initialResumeId={resumeId}
            onDone={(generatedId) => {
              track("tailor_done");
              open({ kind: "generated", id: generatedId });
            }}
          />
        )}
        <p className="flex items-center gap-1.5 text-xs text-fg-subtle">
          <Sparkles size={12} /> {t("tailor.honest")}
        </p>
      </StepCard>
    </div>
  );
}
