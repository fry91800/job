import { create } from "zustand";

// Light / dark / system theme (FRONTEND.md §4). index.html applies the saved choice before
// the first paint with the same rule; this store changes it and follows the system.
export const THEMES = ["light", "dark", "system"] as const;
export type Theme = (typeof THEMES)[number];

const STORAGE_KEY = "job.theme";
const systemDark = () => matchMedia("(prefers-color-scheme: dark)").matches;

// The whole page changes theme at once: colour transitions are off during the switch
// (otherwise some elements fade from the old colours).
function apply(theme: Theme): void {
  const root = document.documentElement;
  root.classList.add("theme-switching");
  root.classList.toggle("dark", theme === "dark" || (theme === "system" && systemDark()));
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove("theme-switching")));
}

function saved(): Theme {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === "light" || value === "dark" || value === "system") return value;
  } catch {
    // Storage unavailable.
  }
  return "system";
}

export const useTheme = create<{ theme: Theme; setTheme: (theme: Theme) => void }>((set) => ({
  theme: saved(),
  setTheme: (theme) => {
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Not kept: fine.
    }
    apply(theme);
    set({ theme });
  },
}));

// The system's theme changes (evening mode): followed when the choice is "system".
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => apply(useTheme.getState().theme));
