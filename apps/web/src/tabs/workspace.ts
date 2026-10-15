import { useCallback, useEffect } from "react";
import { useLocation, useNavigate } from "react-router";
import { tabFromPath, tabPath, type Tab, type TabRef } from "./model";
import { useTabsStore } from "./store";

// Tabs and addresses in step (FRONTEND.md §2.4): every tab has an address; opening,
// activating or closing a tab changes it, and an address typed or reached with the back
// button shows its tab.

const pathOf = (tab: Tab | undefined) => (tab ? tabPath(tab) : "/");

// Mounted once, in the shell. On phones "/" is the list (FRONTEND.md §2.5), so the active
// tab isn't brought back there.
export function useAddressSync(isPhone: boolean): void {
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    const ref = tabFromPath(location.pathname);
    if (ref) {
      useTabsStore.getState().ensure(ref);
      return;
    }
    const { tabs, activeKey } = useTabsStore.getState();
    const active = tabs.find((tab) => tab.key === activeKey);
    if (location.pathname !== "/") navigate({ pathname: "/", search: location.search }, { replace: true });
    else if (active && !isPhone) navigate({ pathname: tabPath(active), search: location.search }, { replace: true });
  }, [location.pathname, location.search, navigate, isPhone]);
}

export function useWorkspace() {
  const navigate = useNavigate();
  const location = useLocation();
  // The search (query string) stays when moving between tabs.
  const go = useCallback((pathname: string) => navigate({ pathname, search: location.search }), [navigate, location.search]);

  const open = useCallback(
    (ref: TabRef, options: { preview?: boolean } = {}) => {
      useTabsStore.getState().open(ref, options.preview);
      go(tabPath(ref));
    },
    [go],
  );

  const activate = useCallback(
    (key: string) => {
      const tab = useTabsStore.getState().tabs.find((item) => item.key === key);
      if (tab) go(tabPath(tab));
    },
    [go],
  );

  // Closes without asking: callers check unsaved changes first (useCloseTabs).
  const close = useCallback(
    (keys: string[]) => {
      const before = useTabsStore.getState().activeKey;
      useTabsStore.getState().close(keys);
      const { tabs, activeKey } = useTabsStore.getState();
      if (activeKey !== before || (before !== null && keys.includes(before))) go(pathOf(tabs.find((tab) => tab.key === activeKey)));
    },
    [go],
  );

  return { open, activate, close, keep: useTabsStore.getState().keep, update: useTabsStore.getState().update };
}
