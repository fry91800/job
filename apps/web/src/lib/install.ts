import { useSyncExternalStore } from "react";
import { track } from "./analytics";

// Installing the app on the device (GROWTH.md phase 2): the site has a manifest and icons,
// so Chrome, Edge and Android offer to install it; their prompt is kept here to be shown
// from the account menu. iPhone and iPad have no prompt: Safari's Share → "Add to Home
// Screen" (the menu explains it). Nothing is shown once the app runs installed.

type InstallPrompt = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

let deferred: InstallPrompt | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault(); // no mini-infobar: the menu offers it
  deferred = event as InstallPrompt;
  notify();
});
window.addEventListener("appinstalled", () => {
  deferred = null;
  track("app_install");
  notify();
});

const standalone = () => window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

export type InstallMode = "prompt" | "ios" | null;

function mode(): InstallMode {
  if (standalone()) return null;
  if (deferred) return "prompt";
  return isIos() ? "ios" : null;
}

export function useInstallMode(): InstallMode {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, mode);
}

export async function promptInstall(): Promise<void> {
  if (!deferred) return;
  const prompt = deferred;
  deferred = null;
  notify();
  await prompt.prompt();
}

// Opened from the installed app's icon (GROWTH.md §5: how many use it installed).
if (standalone()) track("app_open");
