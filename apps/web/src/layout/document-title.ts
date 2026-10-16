import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useTabsStore } from "../tabs/store";

// The browser tab's title follows the active tab ("Développeur React · MonPoste"), for
// browser tabs, bookmarks and history; with no tab open, the name and what the site does.
export function useDocumentTitle(): void {
  const { t } = useTranslation();
  const active = useTabsStore((state) => state.tabs.find((tab) => tab.key === state.activeKey));
  const name = t("app.name");
  const title = active ? `${active.title ?? t(`tabs.kinds.${active.kind}`)} · ${name}` : `${name} · ${t("welcome.title")}`;
  useEffect(() => {
    document.title = title;
  }, [title]);
}
