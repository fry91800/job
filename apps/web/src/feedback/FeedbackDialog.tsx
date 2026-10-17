import * as Dialog from "@radix-ui/react-dialog";
import { useMutation } from "@tanstack/react-query";
import { emailSchema, FEEDBACK_MAX_LENGTH, type FeedbackInput } from "@job/shared";
import { Loader2, X } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { create } from "zustand";
import { api } from "../api/client";
import { useMe } from "../api/queries";
import { track } from "../lib/analytics";
import { errorMessage } from "../lib/errors";
import { toast } from "../lib/toast";

// "Un avis ? Un problème ?" (GROWTH.md phase 0): a message, emailed to the operator, with
// an address to answer (the account's, suggested) and the page it was written from.

export const useFeedbackDialog = create<{ opened: boolean; open(): void; close(): void }>((set) => ({
  opened: false,
  open: () => set({ opened: true }),
  close: () => set({ opened: false }),
}));

const inputClass = "rounded-control border border-border bg-bg px-2.5 outline-none transition-colors duration-150 focus:border-accent aria-[invalid=true]:border-danger";

function FeedbackForm() {
  const { t } = useTranslation();
  const close = useFeedbackDialog((state) => state.close);
  const user = useMe().data?.user ?? null;
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState(user && !user.isGuest ? (user.email ?? "") : "");
  const [checked, setChecked] = useState(false);
  const messageId = useId();
  const emailId = useId();
  const send = useMutation({ mutationFn: (input: FeedbackInput) => api<void>("POST", "/api/feedback", { body: input }) });

  const messageError = checked && !message.trim() ? t("feedback.empty") : null;
  const emailError = checked && email.trim() && !emailSchema.safeParse(email).success ? t("auth.invalidEmail") : null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setChecked(true);
    if (!message.trim() || (email.trim() && !emailSchema.safeParse(email).success)) return;
    try {
      await send.mutateAsync({ message, email: email.trim() || undefined, page: location.pathname.slice(0, 300) });
      track("feedback");
      close();
      toast(t("feedback.sent"));
    } catch {
      // Shown under the form.
    }
  };

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-3">
      <p className="text-sm text-fg-muted">{t("feedback.intro")}</p>
      <div className="flex flex-col gap-1">
        <label htmlFor={messageId} className="text-sm font-medium">
          {t("feedback.message")}
        </label>
        <textarea
          id={messageId}
          autoFocus
          rows={6}
          maxLength={FEEDBACK_MAX_LENGTH}
          placeholder={t("feedback.placeholder")}
          className={`${inputClass} resize-y py-2`}
          aria-invalid={!!messageError}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
        />
        {messageError && <span className="text-xs text-danger">{messageError}</span>}
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={emailId} className="text-sm font-medium">
          {t("feedback.email")}
        </label>
        <input id={emailId} type="email" autoComplete="email" className={`${inputClass} h-9`} aria-invalid={!!emailError} value={email} onChange={(event) => setEmail(event.target.value)} />
        <span className={`text-xs ${emailError ? "text-danger" : "text-fg-muted"}`}>{emailError ?? t("feedback.emailHint")}</span>
      </div>
      {send.error && (
        <p role="alert" className="rounded-control bg-danger/10 px-3 py-2 text-sm text-danger">
          {errorMessage(t, send.error)}
        </p>
      )}
      <button
        type="submit"
        disabled={send.isPending}
        className="mt-1 flex h-9 items-center justify-center gap-2 rounded-control bg-accent px-4 text-sm font-medium text-accent-fg transition-colors duration-150 hover:bg-accent-hover disabled:opacity-70"
      >
        {send.isPending && <Loader2 size={15} className="animate-spin" />}
        {t("feedback.send")}
      </button>
    </form>
  );
}

export function FeedbackDialog() {
  const { t } = useTranslation();
  const { opened, close } = useFeedbackDialog();
  return (
    <Dialog.Root open={opened} onOpenChange={(open) => !open && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="animate-fade-in fixed inset-0 z-40 bg-overlay" />
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-4">
          <Dialog.Content className="animate-pop-in pointer-events-auto w-full max-w-[440px] rounded-box border border-border bg-surface p-6 shadow-float" aria-describedby={undefined}>
            <div className="mb-4 flex items-center justify-between">
              <Dialog.Title className="text-lg font-semibold tracking-tight">{t("feedback.title")}</Dialog.Title>
              <Dialog.Close className="flex size-7 items-center justify-center rounded-control text-fg-subtle transition-colors hover:bg-hover hover:text-fg" aria-label={t("tabs.close")}>
                <X size={16} />
              </Dialog.Close>
            </div>
            {/* A fresh form each time it opens. */}
            {opened && <FeedbackForm />}
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
