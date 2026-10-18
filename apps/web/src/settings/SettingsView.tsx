import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Settings as SettingsIcon } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { MODIFIER_SECTIONS, MODIFIER_STRENGTHS, PASSWORD_MIN_LENGTH, passwordSchema, type Settings, type SettingsResponse } from "@job/shared";
import { AlertsCard } from "../alerts/AlertsCard";
import { api } from "../api/client";
import { keys, queryClient, useMe } from "../api/queries";
import { chooseLanguage, useAuthDialog } from "../auth/session";
import { useSettings, useTemplates } from "../generated/queries";
import { TemplatePicker } from "../generated/TemplatePicker";
import { LANGUAGES, type Language } from "../i18n";
import { confirm } from "../lib/confirm";
import { errorMessage } from "../lib/errors";
import { toast } from "../lib/toast";
import { LegalLinks } from "../legal/LegalLinks";
import { THEMES, useTheme } from "../theme/theme";

// Settings (FEATURE S1, S2, L1) and the account (A5, A7): resume modifier defaults,
// template, interface; password change, log out everywhere, account deletion.

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-box border border-border bg-surface p-5">
      <h2 className="text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Segmented<T extends string | number>({ value, options, onChange, label }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (value: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={`flex h-8 items-center gap-1.5 rounded-control border px-3 text-sm transition-colors duration-150 ${value === option.value ? "border-accent bg-accent-soft text-accent" : "border-border hover:bg-hover"}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function useUpdateSettings() {
  const client = useQueryClient();
  const { t } = useTranslation();
  return useMutation({
    mutationFn: (change: Partial<Settings>) => api<SettingsResponse>("PATCH", "/api/settings", { body: change }),
    // Shown at once (FRONTEND.md §3).
    onMutate: (change) => client.setQueryData<SettingsResponse | null>(["settings"], (current) => (current ? { ...current, ...change } : current)),
    onSuccess: (settings) => {
      client.setQueryData(["settings"], settings);
      void client.invalidateQueries({ queryKey: keys.me });
    },
    onError: (error) => {
      toast(errorMessage(t, error), "error");
      void client.invalidateQueries({ queryKey: ["settings"] });
    },
  });
}

function PasswordForm() {
  const { t } = useTranslation();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [checked, setChecked] = useState(false);
  const change = useMutation({ mutationFn: () => api("POST", "/api/auth/password", { body: { currentPassword: current, newPassword: next } }) });
  const invalid = checked && !passwordSchema.safeParse(next).success;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setChecked(true);
    if (!current || !passwordSchema.safeParse(next).success) return;
    change.mutate(undefined, {
      onSuccess: () => {
        toast(t("settings.passwordChanged"));
        setCurrent("");
        setNext("");
        setChecked(false);
      },
    });
  };
  const input = "h-9 w-full rounded-control border border-border bg-bg px-2.5 outline-none focus:border-accent aria-[invalid=true]:border-danger";
  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-3">
      <h3 className="text-sm font-medium">{t("settings.changePassword")}</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs font-medium text-fg-muted">
          {t("settings.currentPassword")}
          <input type="password" autoComplete="current-password" className={input} value={current} onChange={(event) => setCurrent(event.target.value)} aria-invalid={checked && !current} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-fg-muted">
          {t("auth.newPassword")}
          <input type="password" autoComplete="new-password" className={input} value={next} onChange={(event) => setNext(event.target.value)} aria-invalid={invalid} />
          {invalid && <span className="font-normal text-danger">{t("auth.passwordRule", { min: PASSWORD_MIN_LENGTH })}</span>}
        </label>
      </div>
      {change.error && <p className="text-sm text-danger">{errorMessage(t, change.error)}</p>}
      <p className="text-xs text-fg-subtle">{t("settings.passwordHint")}</p>
      <button type="submit" disabled={change.isPending} className="flex h-8 items-center gap-1.5 self-start rounded-control bg-accent px-3 text-sm font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-60">
        {change.isPending && <Loader2 size={14} className="animate-spin" />}
        {t("settings.savePassword")}
      </button>
    </form>
  );
}

function DangerZone() {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const [open, setOpen] = useState(false);
  const logoutAll = useMutation({ mutationFn: () => api("POST", "/api/auth/logout-all") });
  const remove = useMutation({ mutationFn: () => api("DELETE", "/api/auth/account", { body: { password } }) });
  const afterLeaving = (message: string) => {
    toast(message, "info");
    queryClient.setQueryData(keys.me, { user: null });
    void queryClient.invalidateQueries();
  };
  return (
    <div className="flex flex-col gap-3 border-t border-border pt-4">
      <button
        type="button"
        onClick={() => logoutAll.mutate(undefined, { onSuccess: () => afterLeaving(t("auth.done.logoutAll")), onError: (error) => toast(errorMessage(t, error), "error") })}
        className="self-start text-sm text-fg-muted hover:text-fg hover:underline"
      >
        {t("account.logOutAll")}
      </button>
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className="self-start text-sm text-danger hover:underline">
          {t("settings.deleteAccount")}
        </button>
      ) : (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (!password || !(await confirm({ title: t("settings.deleteTitle"), text: t("settings.deleteText"), confirm: t("settings.deleteConfirm"), danger: true }))) return;
            remove.mutate(undefined, { onSuccess: () => afterLeaving(t("settings.deleted")) });
          }}
          className="flex flex-col gap-2 rounded-box border border-danger/40 bg-danger/5 p-3"
        >
          <p className="text-sm">{t("settings.deleteIntro")}</p>
          <label className="flex flex-col gap-1 text-xs font-medium text-fg-muted">
            {t("auth.password")}
            <input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} className="h-9 rounded-control border border-border bg-bg px-2.5 outline-none focus:border-danger" />
          </label>
          {remove.error && <p className="text-sm text-danger">{errorMessage(t, remove.error)}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={!password || remove.isPending} className="h-8 rounded-control bg-danger px-3 text-sm font-medium text-white disabled:opacity-50">
              {t("settings.deleteConfirm")}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="h-8 rounded-control border border-border px-3 text-sm hover:bg-hover">
              {t("tabs.cancel")}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

export default function SettingsView() {
  const { t, i18n } = useTranslation();
  const settings = useSettings();
  const templates = useTemplates();
  const update = useUpdateSettings();
  const { theme, setTheme } = useTheme();
  const user = useMe().data?.user ?? null;
  const openAuth = useAuthDialog((state) => state.open);
  const current = settings.data;
  const registered = user && !user.isGuest;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5 px-4 py-6 sm:px-8 sm:py-8">
      <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
        <SettingsIcon size={20} className="text-accent" /> {t("tools.settings")}
      </h1>

      <Card title={t("settings.generation")}>
        <p className="-mt-2 text-sm text-fg-muted">{t("settings.generationIntro")}</p>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="accent-[var(--accent)]" checked={current?.modifierEnabled ?? false} onChange={(event) => update.mutate({ modifierEnabled: event.target.checked })} />
          {t("generate.modifier")}
        </label>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-fg-muted">{t("generate.strength")}</span>
          <Segmented
            label={t("generate.strength")}
            value={current?.modifierStrength ?? "soft"}
            options={MODIFIER_STRENGTHS.map((value) => ({ value, label: t(`generate.strengths.${value}`) }))}
            onChange={(modifierStrength) => update.mutate({ modifierStrength })}
          />
          {current && (
            <p className="text-xs text-fg-muted">
              {t(`generate.strengthHints.${current.modifierStrength}`)} · {t("generate.modifies")}{" "}
              {MODIFIER_SECTIONS.filter((section) => current.modifierSectionsByStrength[current.modifierStrength]?.[section])
                .map((section) => t(`resume.sections.${section}`))
                .join(", ")}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-fg-muted">{t("generate.template")}</span>
          <TemplatePicker templates={templates.data?.results ?? []} value={current?.templateId ?? templates.data?.results[0]?.id ?? null} onChange={(templateId) => update.mutate({ templateId })} />
        </div>
        {!current && <p className="text-xs text-fg-subtle">{t("settings.savedOnChange")}</p>}
      </Card>

      <AlertsCard card={(title, children) => <Card title={title}>{children}</Card>} />

      <Card title={t("settings.interface")}>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-fg-muted">{t("account.language")}</span>
          <Segmented label={t("account.language")} value={i18n.language as Language} options={LANGUAGES.map((value) => ({ value, label: value === "fr" ? "Français" : "English" }))} onChange={chooseLanguage} />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-fg-muted">{t("account.theme")}</span>
          <Segmented label={t("account.theme")} value={theme} options={THEMES.map((value) => ({ value, label: t(`account.themes.${value}`) }))} onChange={setTheme} />
        </div>
      </Card>

      <Card title={t("settings.account")}>
        {registered ? (
          <>
            <div className="flex flex-col gap-0.5 text-sm">
              <span>{user.email}</span>
              <span className={`text-xs ${user.emailVerified ? "text-success" : "text-warning"}`}>{user.emailVerified ? t("settings.emailVerified") : t("settings.emailUnverified")}</span>
            </div>
            <PasswordForm />
            <DangerZone />
          </>
        ) : (
          <div className="flex flex-col items-start gap-2 text-sm text-fg-muted">
            <p>{t("auth.guestReminder")}</p>
            <button type="button" onClick={() => openAuth("signup")} className="rounded-control bg-accent px-3 py-1.5 font-medium text-accent-fg hover:bg-accent-hover">
              {t("account.signUp")}
            </button>
          </div>
        )}
      </Card>

      <LegalLinks className="justify-center" />
    </div>
  );
}
