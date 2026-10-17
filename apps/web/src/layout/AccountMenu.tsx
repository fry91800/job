import { ChevronDown, CircleUser, MailWarning, MonitorDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useFeedbackDialog } from "../feedback/FeedbackDialog";
import { useWorkspace } from "../tabs/workspace";
import { useMe } from "../api/queries";
import { chooseLanguage, useAuthDialog, useLogout, useResendVerification } from "../auth/session";
import { LANGUAGES, type Language } from "../i18n";
import { errorMessage } from "../lib/errors";
import { promptInstall, useInstallMode } from "../lib/install";
import { toast } from "../lib/toast";
import { THEMES, useTheme } from "../theme/theme";
import { MenuChoice, MenuContent, MenuItem, MenuLabel, MenuRoot, MenuSeparator, MenuTrigger } from "./menu";

// Account menu (FRONTEND.md §2.1): log in / sign up for visitors and guests; the address,
// its confirmation and logging out for accounts; theme, language and the legal pages for
// everyone.
export function AccountMenu({ compact = false }: { compact?: boolean }) {
  const { t, i18n } = useTranslation();
  const { theme, setTheme } = useTheme();
  const user = useMe().data?.user ?? null;
  const openAuth = useAuthDialog((state) => state.open);
  const logout = useLogout();
  const resend = useResendVerification();
  const { open } = useWorkspace();
  const openFeedback = useFeedbackDialog((state) => state.open);
  const install = useInstallMode();
  const registered = user !== null && !user.isGuest;
  const unverified = registered && !user.emailVerified;

  return (
    <MenuRoot>
      <MenuTrigger asChild>
        <button
          type="button"
          aria-label={compact ? t("account.menu") : `${t("account.menu")} : ${registered ? user.email : t("account.guest")}`}
          className="relative flex h-8 min-w-0 items-center gap-1.5 rounded-control px-2 text-sm text-fg-muted transition-colors duration-150 hover:bg-hover hover:text-fg data-[state=open]:bg-hover"
        >
          <CircleUser size={18} strokeWidth={1.75} className={registered ? "text-accent" : ""} />
          {unverified && <span className="absolute left-5 top-1 size-2 rounded-full border-2 border-sidebar bg-warning" />}
          {!compact && (
            <>
              <span className="max-w-28 truncate">{registered ? user.email : t("account.guest")}</span>
              <ChevronDown size={14} className="shrink-0" />
            </>
          )}
        </button>
      </MenuTrigger>
      <MenuContent align="end">
        {registered ? (
          <>
            <MenuLabel>{t("account.signedInAs")}</MenuLabel>
            <div className="truncate px-2 pb-1.5 text-sm">{user.email}</div>
            {unverified && (
              <MenuItem
                onSelect={() =>
                  resend.mutate(undefined, {
                    onSuccess: () => toast(t("auth.verificationSent")),
                    onError: (error) => toast(errorMessage(t, error), "error"),
                  })
                }
              >
                <MailWarning size={14} className="text-warning" /> {t("auth.resendVerification")}
              </MenuItem>
            )}
            <MenuItem onSelect={() => logout.mutate(false, { onSuccess: () => toast(t("auth.done.logout"), "info") })}>{t("account.logOut")}</MenuItem>
            <MenuItem onSelect={() => logout.mutate(true, { onSuccess: () => toast(t("auth.done.logoutAll"), "info") })}>{t("account.logOutAll")}</MenuItem>
          </>
        ) : (
          <>
            <MenuItem onSelect={() => openAuth("login")}>{t("account.logIn")}</MenuItem>
            <MenuItem onSelect={() => openAuth("signup")}>{t("account.signUp")}</MenuItem>
          </>
        )}
        <MenuSeparator />
        <MenuLabel>{t("account.theme")}</MenuLabel>
        <MenuChoice value={theme} options={THEMES.map((value) => ({ value, label: t(`account.themes.${value}`) }))} onChange={setTheme} />
        <MenuSeparator />
        <MenuLabel>{t("account.language")}</MenuLabel>
        <MenuChoice
          value={i18n.language as Language}
          options={LANGUAGES.map((value) => ({ value, label: value === "fr" ? "Français" : "English" }))}
          onChange={chooseLanguage}
        />
        <MenuSeparator />
        {install && (
          <MenuItem onSelect={() => (install === "prompt" ? void promptInstall() : toast(t("install.ios"), "info"))}>
            <MonitorDown size={14} /> {t("install.action")}
          </MenuItem>
        )}
        <MenuItem onSelect={openFeedback}>{t("feedback.open")}</MenuItem>
        <MenuItem onSelect={() => open({ kind: "privacy" })}>{t("tabs.kinds.privacy")}</MenuItem>
        <MenuItem onSelect={() => open({ kind: "terms" })}>{t("tabs.kinds.terms")}</MenuItem>
      </MenuContent>
    </MenuRoot>
  );
}
