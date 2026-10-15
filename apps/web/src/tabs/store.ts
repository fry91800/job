import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { activateTab, closeTabs, EMPTY, ensureTab, keepTab, openTab, restore, updateTab, type TabRef, type TabsState } from "./model";

// The open tabs, kept in the browser and restored on the next visit (FRONTEND.md §2.4).
// Components don't change it directly: they go through useWorkspace(), which keeps the
// address bar in step.

type TabsStore = TabsState & {
  open(ref: TabRef, preview?: boolean): void;
  ensure(ref: TabRef): void;
  activate(key: string): void;
  keep(key: string): void;
  close(keys: string[]): void;
  update(key: string, change: { dirty?: boolean; title?: string | null }): void;
};

export const useTabsStore = create<TabsStore>()(
  persist(
    (set) => ({
      ...EMPTY,
      open: (ref, preview) => set((state) => openTab(state, ref, { preview, now: Date.now() })),
      ensure: (ref) => set((state) => ensureTab(state, ref, Date.now())),
      activate: (key) => set((state) => activateTab(state, key, Date.now())),
      keep: (key) => set((state) => keepTab(state, key)),
      close: (keys) => set((state) => closeTabs(state, keys)),
      update: (key, change) => set((state) => updateTab(state, key, change)),
    }),
    {
      name: "job.tabs",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ tabs: state.tabs, activeKey: state.activeKey }),
      merge: (persisted, current) => ({ ...current, ...restore(persisted) }),
    },
  ),
);
