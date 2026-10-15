import { ArrowLeft, Layers } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router";
import { useTabsStore } from "../tabs/store";
import { useAddressSync, useWorkspace } from "../tabs/workspace";
import { VIEWS } from "../views/registry";
import { ConfirmCloseDialog } from "./close-tabs";
import { IconButton } from "./IconButton";
import { MenuContent, MenuItem, MenuRoot, MenuTrigger } from "./menu";
import { Sidebar } from "./Sidebar";
import { TabBar, useTabTitle } from "./TabBar";
import { TabPanels } from "./TabPanels";
import { usePhone } from "./use-media-query";
import { Welcome } from "./Welcome";

function Desktop() {
  const hasTabs = useTabsStore((state) => state.tabs.length > 0 && state.activeKey !== null);
  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col">
        {hasTabs ? (
          <>
            <TabBar />
            <TabPanels />
          </>
        ) : (
          <Welcome />
        )}
      </main>
    </div>
  );
}

function TabTitle() {
  const tab = useTabsStore((state) => state.tabs.find((item) => item.key === state.activeKey));
  const title = useTabTitle(tab ?? { kind: "offer", key: "", preview: false, dirty: false, title: null, lastActive: 0 });
  return <span className="truncate font-medium">{tab ? title : ""}</span>;
}

// Phones (FRONTEND.md §2.5): "/" is the list; a tab's address shows it full screen with a
// back button and a switcher between open tabs.
function Phone() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const { activate } = useWorkspace();
  const tabs = useTabsStore((state) => state.tabs);
  if (location.pathname === "/") return <Sidebar phone />;
  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center gap-1 border-b border-border bg-sidebar px-2">
        <IconButton icon={ArrowLeft} label={t("tabs.back")} onClick={() => navigate({ pathname: "/", search: location.search })} />
        <div className="min-w-0 flex-1">
          <TabTitle />
        </div>
        <MenuRoot>
          <MenuTrigger asChild>
            <IconButton icon={Layers} label={t("tabs.switcher")} />
          </MenuTrigger>
          <MenuContent align="end">
            {tabs.map((tab) => {
              const Icon = VIEWS[tab.kind].icon;
              return (
                <MenuItem key={tab.key} onSelect={() => activate(tab.key)}>
                  <Icon size={14} /> <PhoneTabLabel tabKey={tab.key} />
                </MenuItem>
              );
            })}
          </MenuContent>
        </MenuRoot>
      </header>
      <TabPanels />
    </div>
  );
}

function PhoneTabLabel({ tabKey }: { tabKey: string }) {
  const tab = useTabsStore((state) => state.tabs.find((item) => item.key === tabKey))!;
  return <span className="truncate">{useTabTitle(tab)}</span>;
}

export function Shell() {
  const phone = usePhone();
  useAddressSync(phone);
  return (
    <>
      {phone ? <Phone /> : <Desktop />}
      <ConfirmCloseDialog />
    </>
  );
}
