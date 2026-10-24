import * as Dialog from "@radix-ui/react-dialog";
import { Loader2, PenLine, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { create } from "zustand";
import { errorMessage } from "../lib/errors";
import { useResumes } from "../resumes/queries";
import { useWorkspace } from "../tabs/workspace";
import { useWriteLetter } from "./queries";

// Writing a cover letter for an offer (FEATURE M5): the resume it is written from, then the
// AI writes it, in the offer's language; the letter opens in its tab, ready to edit.

export const useLetterDialog = create<{ offer: { id: string; title: string } | null; open(offer: { id: string; title: string }): void; close(): void }>((set) => ({
  offer: null,
  open: (offer) => set({ offer }),
  close: () => set({ offer: null }),
}));

// Also used by the guided path (offers/TailorView), with the resume chosen there.
export function LetterForm({ offerId, onDone, initialResumeId = null }: { offerId: string; onDone: (letterId: string) => void; initialResumeId?: string | null }) {
  const { t } = useTranslation();
  const { open } = useWorkspace();
  const resumes = useResumes();
  const write = useWriteLetter();
  const list = resumes.data?.results ?? [];
  const [resumeId, setResumeId] = useState<string | null>(initialResumeId);

  useEffect(() => {
    if (resumeId === null && list.length) setResumeId(list.find((item) => item.isSelected)?.id ?? list[0].id);
  }, [list, resumeId]);

  if (resumes.data && list.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-fg-muted">{t("letter.needResume")}</p>
        <button type="button" onClick={() => open({ kind: "resumes" })} className="self-start rounded-control bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg hover:bg-accent-hover">
          {t("welcome.upload")}
        </button>
      </div>
    );
  }

  if (write.isPending) {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <Loader2 size={24} className="animate-spin text-accent" />
        <p className="font-medium">{t("letter.writing")}</p>
        <p className="text-sm text-fg-subtle">{t("letter.writingHint")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {list.length > 1 && (
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs font-medium text-fg-muted">{t("generate.resume")}</span>
          <select value={resumeId ?? ""} onChange={(event) => setResumeId(event.target.value)} className="h-9 rounded-control border border-border bg-bg px-2 outline-none focus:border-accent">
            {list.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} ({item.language.toUpperCase()})
              </option>
            ))}
          </select>
        </label>
      )}
      <p className="text-sm text-fg-muted">{t("letter.explain")}</p>
      {write.error && (
        <p role="alert" className="rounded-control bg-danger/10 px-3 py-2 text-sm text-danger">
          {errorMessage(t, write.error)}
        </p>
      )}
      <button
        type="button"
        disabled={!resumeId}
        onClick={() => write.mutate({ offerId, resumeId: resumeId ?? undefined }, { onSuccess: (letter) => onDone(letter.id) })}
        className="flex h-9 items-center justify-center gap-2 rounded-control bg-accent px-4 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-50"
      >
        <PenLine size={15} /> {t("letter.write")}
      </button>
    </div>
  );
}

export function LetterDialog() {
  const { t } = useTranslation();
  const { offer, close } = useLetterDialog();
  const { open } = useWorkspace();
  return (
    <Dialog.Root open={offer !== null} onOpenChange={(value) => !value && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="animate-fade-in fixed inset-0 z-40 bg-overlay" />
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-4">
          <Dialog.Content className="animate-pop-in pointer-events-auto max-h-[calc(100vh-32px)] w-full max-w-[460px] overflow-y-auto rounded-box border border-border bg-surface p-6 shadow-float" aria-describedby={undefined}>
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Dialog.Title className="text-lg font-semibold tracking-tight">{t("letter.title")}</Dialog.Title>
                <p className="truncate text-sm text-fg-muted">{offer?.title}</p>
              </div>
              <Dialog.Close className="flex size-7 shrink-0 items-center justify-center rounded-control text-fg-subtle transition-colors hover:bg-hover hover:text-fg" aria-label={t("tabs.close")}>
                <X size={16} />
              </Dialog.Close>
            </div>
            {offer && (
              <LetterForm
                key={offer.id}
                offerId={offer.id}
                onDone={(letterId) => {
                  close();
                  open({ kind: "letter", id: letterId });
                }}
              />
            )}
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
