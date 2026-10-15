import { ChevronDown, CircleUser } from "lucide-react";
import { useTranslation } from "react-i18next";
import { LANGUAGES, setLanguage, type Language } from "../i18n";
import { THEMES, useTheme } from "../theme/theme";
import { MenuChoice, MenuContent, MenuItem, MenuLabel, MenuRoot, MenuSeparator, MenuTrigger } from "./menu";

// Account menu (FRONTEND.md §2.1). Logging in and signing up come with step 3; until then
// everyone is a guest.
export function AccountMenu({ compact = false }: { compact?: boolean }) {
  const { t, i18n } = useTranslation();
  const { theme, setTheme } = useTheme();
  return (
    <MenuRoot>
      <MenuTrigger asChild>
        <button
          type="button"
          aria-label={t("account.menu")}
          className="flex h-8 items-center gap-1.5 rounded-control px-2 text-sm text-fg-muted transition-colors duration-150 hover:bg-hover hover:text-fg data-[state=open]:bg-hover"
        >
          <CircleUser size={18} strokeWidth={1.75} />
          {!compact && (
            <>
              <span>{t("account.guest")}</span>
              <ChevronDown size={14} />
            </>
          )}
        </button>
      </MenuTrigger>
      <MenuContent align="end">
        <MenuItem disabled>
          {t("account.logIn")} <span className="ml-auto text-xs">{t("account.soon")}</span>
        </MenuItem>
        <MenuItem disabled>
          {t("account.signUp")} <span className="ml-auto text-xs">{t("account.soon")}</span>
        </MenuItem>
        <MenuSeparator />
        <MenuLabel>{t("account.theme")}</MenuLabel>
        <MenuChoice value={theme} options={THEMES.map((value) => ({ value, label: t(`account.themes.${value}`) }))} onChange={setTheme} />
        <MenuSeparator />
        <MenuLabel>{t("account.language")}</MenuLabel>
        <MenuChoice
          value={i18n.language as Language}
          options={LANGUAGES.map((value) => ({ value, label: value === "fr" ? "Français" : "English" }))}
          onChange={setLanguage}
        />
      </MenuContent>
    </MenuRoot>
  );
}
