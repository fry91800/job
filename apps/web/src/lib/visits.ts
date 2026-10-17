import { useSyncExternalStore } from "react";

// "Nouveau" marks (GROWTH.md phase 2): offers MonPoste found since the visitor's previous
// visit, on this device. A visit ends after 30 minutes without the page in view; the first
// visit marks nothing (everything would be new). Kept in localStorage: a convenience, so
// without storage (private window) there are simply no marks.

const KEY = "monposte.visits";
const GAP_MS = 30 * 60_000;

type Visits = { previous: number | null; lastActive: number };

function load(): Visits | null {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? "null") as Visits | null;
    return value && typeof value.lastActive === "number" ? value : null;
  } catch {
    return null;
  }
}

function save(value: Visits): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    // No storage: no marks.
  }
}

const listeners = new Set<() => void>();

// The page comes into view (or loads): a new visit when the last activity is old enough.
function touch(current: Visits | null): Visits {
  const now = Date.now();
  if (!current) return { previous: null, lastActive: now };
  return now - current.lastActive > GAP_MS ? { previous: current.lastActive, lastActive: now } : { ...current, lastActive: now };
}

let visits = touch(load());
save(visits);

function refresh() {
  if (document.visibilityState !== "visible") return;
  const next = touch(load() ?? visits); // another tab may have moved it on
  const changed = next.previous !== visits.previous;
  visits = next;
  save(visits);
  if (changed) listeners.forEach((listener) => listener());
}
document.addEventListener("visibilitychange", refresh);
setInterval(refresh, 60_000);

// When the previous visit ended (ms), or null on a first visit.
export function usePreviousVisit(): number | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => visits.previous,
  );
}
