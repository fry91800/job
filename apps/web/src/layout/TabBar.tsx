import { MoreHorizontal, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { Tab } from "../tabs/model";
import { useTabsStore } from "../tabs/store";
import { useWorkspace } from "../tabs/workspace";
import { VIEWS } from "../views/registry";
import { useCloseTabs } from "./close-tabs";
import { MenuContent, MenuItem, MenuRoot, MenuTrigger } from "./menu";

export function useTabTitle(tab: Tab): string {
  const { t } = useTranslation();
  return tab.title ?? t(`tabs.kinds.${tab.kind}`);
}

function TabButton({ tab, active }: { tab: Tab; active: boolean }) {
  const { t } = useTranslation();
  const { activate, keep } = useWorkspace();
  const closeTabs = useCloseTabs();
  const title = useTabTitle(tab);
  const Icon = VIEWS[tab.kind].icon;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active]);
  return (
    <div
      ref={ref}
      role="tab"
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      title={tab.preview ? t("tabs.preview") : title}
      onClick={() => activate(tab.key)}
      onDoubleClick={() => keep(tab.key)}
      onAuxClick={(event) => event.button === 1 && closeTabs([tab.key])}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") activate(tab.key);
        if (event.key === "Delete") closeTabs([tab.key]);
      }}
      className={`group relative flex h-9 max-w-56 shrink-0 cursor-default select-none items-center gap-2 border-r border-border pl-3 pr-1.5 text-sm transition-colors duration-150 ${
        active ? "bg-bg text-fg" : "bg-sidebar text-fg-muted hover:text-fg"
      }`}
    >
      {active && <span className="absolute inset-x-0 top-0 h-0.5 bg-accent" />}
      <Icon size={14} strokeWidth={1.75} className={active ? "text-accent" : ""} />
      <span className={`truncate ${tab.preview ? "italic" : ""}`}>{title}</span>
      <button
        type="button"
        aria-label={t("tabs.close")}
        onClick={(event) => {
          event.stopPropagation();
          closeTabs([tab.key]);
        }}
        className={`flex size-5 items-center justify-center rounded-control transition-colors hover:bg-hover ${active || tab.dirty ? "" : "opacity-0 group-hover:opacity-100"}`}
      >
        {tab.dirty ? <span className="size-2 rounded-full bg-fg-muted group-hover:hidden" /> : null}
        <X size={14} className={tab.dirty ? "hidden group-hover:block" : ""} />
      </button>
    </div>
  );
}

export function TabBar() {
  const { t } = useTranslation();
  const tabs = useTabsStore((state) => state.tabs);
  const activeKey = useTabsStore((state) => state.activeKey);
  const closeTabs = useCloseTabs();
  return (
    <div className="flex h-9 shrink-0 items-stretch border-b border-border bg-sidebar">
      <div role="tablist" className="flex min-w-0 flex-1 overflow-x-auto [scrollbar-width:none]">
        {tabs.map((tab) => (
          <TabButton key={tab.key} tab={tab} active={tab.key === activeKey} />
        ))}
      </div>
      <MenuRoot>
        <MenuTrigger asChild>
          <button type="button" aria-label={t("tabs.switcher")} className="flex w-9 items-center justify-center text-fg-muted transition-colors hover:bg-hover hover:text-fg">
            <MoreHorizontal size={16} />
          </button>
        </MenuTrigger>
        <MenuContent align="end">
          <MenuItem disabled={!activeKey || tabs.length < 2} onSelect={() => closeTabs(tabs.filter((tab) => tab.key !== activeKey).map((tab) => tab.key))}>
            {t("tabs.closeOthers")}
          </MenuItem>
          <MenuItem onSelect={() => closeTabs(tabs.map((tab) => tab.key))}>{t("tabs.closeAll")}</MenuItem>
        </MenuContent>
      </MenuRoot>
    </div>
  );
}
