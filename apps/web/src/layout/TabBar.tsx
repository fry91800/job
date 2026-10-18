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
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active]);
  // A tab list holds tabs only: the close button is for the pointer, and the keyboard closes
  // a tab with Delete (WAI-ARIA tabs pattern), announced on the tab.
  return (
    <div
      role="presentation"
      onAuxClick={(event) => event.button === 1 && closeTabs([tab.key])}
      className={`group relative flex h-9 max-w-56 shrink-0 select-none items-center border-r border-border text-sm transition-colors duration-150 ${
        active ? "bg-bg text-fg" : "bg-sidebar text-fg-muted hover:text-fg"
      }`}
    >
      {active && <span className="absolute inset-x-0 top-0 h-0.5 bg-accent" />}
      <button
        ref={ref}
        type="button"
        role="tab"
        aria-selected={active}
        tabIndex={active ? 0 : -1}
        data-tab-key={tab.key}
        aria-keyshortcuts="Delete"
        title={tab.preview ? t("tabs.preview") : title}
        onClick={() => activate(tab.key)}
        onDoubleClick={() => keep(tab.key)}
        className="flex h-full min-w-0 cursor-default items-center gap-2 pl-3 pr-1"
      >
        <Icon size={14} strokeWidth={1.75} className={`shrink-0 ${active ? "text-accent" : ""}`} />
        <span className={`truncate ${tab.preview ? "italic" : ""}`}>{title}</span>
      </button>
      <button
        type="button"
        aria-hidden
        tabIndex={-1}
        title={t("tabs.close")}
        onClick={() => closeTabs([tab.key])}
        className={`mr-1.5 flex size-5 shrink-0 items-center justify-center rounded-control transition-colors hover:bg-hover ${active || tab.dirty ? "" : "opacity-0 focus-visible:opacity-100 group-hover:opacity-100"}`}
      >
        {tab.dirty ? <span className="size-2 rounded-full bg-fg-muted group-hover:hidden" /> : null}
        <X size={14} className={tab.dirty ? "hidden group-hover:block" : ""} />
      </button>
    </div>
  );
}

// Keyboard (WAI-ARIA tabs): arrows move between tabs, Home/End to the ends, Delete closes.
function useTabKeys() {
  const { activate } = useWorkspace();
  const closeTabs = useCloseTabs();
  return (event: React.KeyboardEvent<HTMLDivElement>) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[role=tab]");
    if (!target) return;
    const tabs = [...event.currentTarget.querySelectorAll<HTMLElement>("[role=tab]")];
    const index = tabs.indexOf(target);
    const go = (next: number) => {
      event.preventDefault();
      const tab = tabs[(next + tabs.length) % tabs.length];
      tab.focus();
      activate(tab.dataset.tabKey!);
    };
    if (event.key === "ArrowRight") go(index + 1);
    else if (event.key === "ArrowLeft") go(index - 1);
    else if (event.key === "Home") go(0);
    else if (event.key === "End") go(tabs.length - 1);
    else if (event.key === "Delete") closeTabs([target.dataset.tabKey!]);
  };
}

export function TabBar() {
  const { t } = useTranslation();
  const tabs = useTabsStore((state) => state.tabs);
  const activeKey = useTabsStore((state) => state.activeKey);
  const closeTabs = useCloseTabs();
  const onTabKeys = useTabKeys();
  return (
    <div className="flex h-9 shrink-0 items-stretch border-b border-border bg-sidebar">
      <div role="tablist" onKeyDown={onTabKeys} className="flex min-w-0 flex-1 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
