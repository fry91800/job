import { create } from "zustand";
import { persist } from "zustand/middleware";

// Sidebar width and collapsed state, kept in the browser (FRONTEND.md §2.1).
export const SIDEBAR = { min: 280, max: 520, default: 340 };

export const useSidebarStore = create<{ width: number; collapsed: boolean; setWidth(width: number): void; toggle(): void }>()(
  persist(
    (set) => ({
      width: SIDEBAR.default,
      collapsed: false,
      setWidth: (width) => set({ width: Math.round(Math.min(SIDEBAR.max, Math.max(SIDEBAR.min, width))) }),
      toggle: () => set((state) => ({ collapsed: !state.collapsed })),
    }),
    { name: "job.sidebar" },
  ),
);
