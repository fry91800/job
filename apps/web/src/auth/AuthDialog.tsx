import * as Dialog from "@radix-ui/react-dialog";
import { Loader2, X } from "lucide-react";
import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { Trans, useTranslation } from "react-i18next";
import { emailSchema, PASSWORD_MIN_LENGTH, passwordSchema } from "@job/shared";
import { errorMessage } from "../lib/errors";
import { toast } from "../lib/toast";
import { useAuthDialog, useLogin, useResetConfirm, useResetRequest, useSignup, type AuthMode } from "./session";

// Log in, sign up, forgotten password, new password from an emailed link (FEATURE A1, A2,
// A4). Fields are checked with the API's own rules (shared schemas); API errors are shown
// translated under the form.

function Field({ label, error, children }: { label: string; error?: string | null; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children(id)}
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}

const inputClass = "h-9 rounded-control border border-border bg-bg px-2.5 outline-none transition-colors duration-150 focus:border-accent aria-[invalid=true]:border-danger";

function Submit({ pending, children }: { pending: boolean; children: ReactNode }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-1 flex h-9 items-center justify-center gap-2 rounded-control bg-accent px-4 text-sm font-medium text-accent-fg transition-colors duration-150 hover:bg-accent-hover disabled:opacity-70"
    >
      {pending && <Loader2 size={15} className="animate-spin" />}
      {children}
    </button>
  );
}

function AuthForm({ mode, token }: { mode: AuthMode; token: string | null }) {
  const { t } = useTranslation();
  const { open, close } = useAuthDialog();
  const login = useLogin();
  const signup = useSignup();
  const resetRequest = useResetRequest();
  const resetConfirm = useResetConfirm();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [checked, setChecked] = useState(false);
  const [sent, setSent] = useState(false);

  const needsEmail = mode !== "reset";
  const needsPassword = mode !== "forgot";
  const newPassword = mode === "signup" || mode === "reset";
  const emailError = checked && needsEmail && !emailSchema.safeParse(email).success ? t("auth.invalidEmail") : null;
  const passwordError =
    checked && needsPassword && (newPassword ? !passwordSchema.safeParse(password).success : !password) ? (newPassword ? t("auth.passwordRule", { min: PASSWORD_MIN_LENGTH }) : t("auth.passwordRequired")) : null;
  const mutation = { login, signup, forgot: resetRequest, reset: resetConfirm }[mode];

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setChecked(true);
    if ((needsEmail && !emailSchema.safeParse(email).success) || (needsPassword && (newPassword ? !passwordSchema.safeParse(password).success : !password))) return;
    try {
      if (mode === "login") await login.mutateAsync({ email, password });
      if (mode === "signup") await signup.mutateAsync({ email, password });
      if (mode === "reset") await resetConfirm.mutateAsync({ token: token ?? "", password });
      if (mode === "forgot") {
        await resetRequest.mutateAsync(email);
        setSent(true);
        return;
      }
      close();
      toast(t(`auth.done.${mode}`));
    } catch {
      // Shown under the form.
    }
  };

  if (sent) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-fg-muted">{t("auth.resetSent", { email })}</p>
        <button type="button" onClick={() => open("login")} className="self-start text-sm text-accent hover:underline">
          {t("auth.backToLogin")}
        </button>
      </div>
    );
  }

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-3">
      {mode === "signup" && <p className="text-sm text-fg-muted">{t("auth.signupIntro")}</p>}
      {mode === "forgot" && <p className="text-sm text-fg-muted">{t("auth.forgotIntro")}</p>}
      {needsEmail && (
        <Field label={t("auth.email")} error={emailError}>
          {(id) => (
            <input id={id} type="email" autoComplete="email" autoFocus className={inputClass} aria-invalid={!!emailError} value={email} onChange={(event) => setEmail(event.target.value)} />
          )}
        </Field>
      )}
      {needsPassword && (
        <Field label={newPassword ? t("auth.newPassword") : t("auth.password")} error={passwordError}>
          {(id) => (
            <input
              id={id}
              type="password"
              autoComplete={newPassword ? "new-password" : "current-password"}
              autoFocus={!needsEmail}
              className={inputClass}
              aria-invalid={!!passwordError}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          )}
        </Field>
      )}
      {mode === "login" && (
        <button type="button" onClick={() => open("forgot")} className="-mt-1 self-start text-xs text-fg-muted hover:text-fg hover:underline">
          {t("auth.forgot")}
        </button>
      )}
      {mutation.error && (
        <p role="alert" className="rounded-control bg-danger/10 px-3 py-2 text-sm text-danger">
          {errorMessage(t, mutation.error)}
        </p>
      )}
      {mode === "signup" && (
        // In a new browser tab: the form stays as filled.
        <p className="text-xs text-fg-muted">
          <Trans
            i18nKey="auth.signupLegal"
            components={{
              terms: <a href="/terms" target="_blank" rel="noopener" className="text-accent hover:underline" />,
              privacy: <a href="/privacy" target="_blank" rel="noopener" className="text-accent hover:underline" />,
            }}
          />
        </p>
      )}
      <Submit pending={mutation.isPending}>{t(`auth.submit.${mode}`)}</Submit>
      {mode === "login" && (
        <p className="text-center text-sm text-fg-muted">
          {t("auth.noAccount")}{" "}
          <button type="button" onClick={() => open("signup")} className="text-accent hover:underline">
            {t("account.signUp")}
          </button>
        </p>
      )}
      {mode === "signup" && (
        <p className="text-center text-sm text-fg-muted">
          {t("auth.haveAccount")}{" "}
          <button type="button" onClick={() => open("login")} className="text-accent hover:underline">
            {t("account.logIn")}
          </button>
        </p>
      )}
    </form>
  );
}

export function AuthDialog() {
  const { t } = useTranslation();
  const { mode, token, close } = useAuthDialog();
  // A new mode starts a fresh form (no leftover error or fields).
  const [formKey, setFormKey] = useState(0);
  useEffect(() => setFormKey((key) => key + 1), [mode]);
  return (
    <Dialog.Root open={mode !== null} onOpenChange={(open) => !open && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="animate-fade-in fixed inset-0 z-40 bg-overlay" />
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-4">
          <Dialog.Content className="animate-pop-in pointer-events-auto w-full max-w-[380px] rounded-box border border-border bg-surface p-6 shadow-float" aria-describedby={undefined}>
            <div className="mb-4 flex items-center justify-between">
              <Dialog.Title className="text-lg font-semibold tracking-tight">{mode && t(`auth.title.${mode}`)}</Dialog.Title>
              <Dialog.Close className="flex size-7 items-center justify-center rounded-control text-fg-subtle transition-colors hover:bg-hover hover:text-fg" aria-label={t("tabs.close")}>
                <X size={16} />
              </Dialog.Close>
            </div>
            {mode && <AuthForm key={formKey} mode={mode} token={token} />}
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
