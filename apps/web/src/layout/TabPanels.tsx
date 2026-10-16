import { Suspense } from "react";
import { useTabsStore } from "../tabs/store";
import { VIEWS } from "../views/registry";

// Every open tab stays mounted, only the active one is shown: switching back finds it
// exactly as left (scroll, forms, review progress — FRONTEND.md §5).
function TabSkeleton() {
  return (
    <div className="flex flex-col gap-3 p-10">
      <div className="h-6 w-1/3 animate-pulse rounded-control bg-hover" />
      <div className="h-4 w-2/3 animate-pulse rounded-control bg-hover" />
      <div className="h-4 w-1/2 animate-pulse rounded-control bg-hover" />
    </div>
  );
}

export function TabPanels() {
  const tabs = useTabsStore((state) => state.tabs);
  const activeKey = useTabsStore((state) => state.activeKey);
  return (
    <div className="relative min-h-0 flex-1">
      {tabs.map((tab) => {
        const View = VIEWS[tab.kind].view;
        const active = tab.key === activeKey;
        return (
          // Focusable, so the keyboard can scroll a panel without controls (a legal page).
          <section key={tab.key} role="tabpanel" tabIndex={0} hidden={!active} className="animate-fade-in absolute inset-0 overflow-y-auto focus-visible:-outline-offset-2">
            <Suspense fallback={<TabSkeleton />}>
              <View tab={tab} active={active} />
            </Suspense>
          </section>
        );
      })}
    </div>
  );
}
