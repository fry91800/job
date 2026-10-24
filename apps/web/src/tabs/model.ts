// The workspace's tabs (FRONTEND.md §2.2): pure functions over the tab list, used by the
// tab store. One tab per thing; a single reused preview tab; at most MAX_TABS tabs.

export const TAB_KINDS = ["offer", "generated", "letter", "resumes", "photos", "saved", "history", "settings", "add-offer", "tailor", "write-letter", "new-resume", "privacy", "terms"] as const;
export type TabKind = (typeof TAB_KINDS)[number];

// What a tab shows: a kind, and an id for the kinds that show one thing (an offer…).
export type TabRef = { kind: TabKind; id?: string };

export type Tab = TabRef & {
  key: string;
  preview: boolean; // replaced by the next preview until kept open
  dirty: boolean; // unsaved changes: closing asks first
  title: string | null; // set by the tab's content (e.g. the offer's title)
  lastActive: number;
};

export type TabsState = { tabs: Tab[]; activeKey: string | null };

export const MAX_TABS = 10;
export const EMPTY: TabsState = { tabs: [], activeKey: null };

const WITH_ID: ReadonlySet<TabKind> = new Set(["offer", "generated", "letter"]);

export const tabKey = (ref: TabRef) => (ref.id ? `${ref.kind}:${ref.id}` : ref.kind);

// Addresses (FRONTEND.md §2.4).
const PATHS: Record<Exclude<TabKind, "offer" | "generated" | "letter">, string> = {
  resumes: "/resumes",
  photos: "/photos",
  saved: "/saved",
  history: "/generated",
  settings: "/settings",
  "add-offer": "/add-offer",
  tailor: "/adapter-mon-cv", // the guided paths the tool pages lead to (SEO.md)
  "write-letter": "/ma-lettre-de-motivation",
  "new-resume": "/creer-mon-cv",
  privacy: "/privacy",
  terms: "/terms",
};

export function tabPath(ref: TabRef): string {
  if (ref.kind === "offer") return `/offers/${encodeURIComponent(ref.id ?? "")}`;
  if (ref.kind === "generated") return `/generated/${encodeURIComponent(ref.id ?? "")}`;
  if (ref.kind === "letter") return `/letters/${encodeURIComponent(ref.id ?? "")}`;
  return PATHS[ref.kind];
}

export function tabFromPath(pathname: string): TabRef | null {
  const path = pathname.replace(/\/+$/, "") || "/";
  const withId = /^\/(offers|generated|letters)\/([^/]+)$/.exec(path);
  if (withId) return { kind: ({ offers: "offer", generated: "generated", letters: "letter" } as const)[withId[1] as "offers" | "generated" | "letters"], id: decodeURIComponent(withId[2]) };
  const kind = (Object.keys(PATHS) as (keyof typeof PATHS)[]).find((key) => PATHS[key] === path);
  return kind ? { kind } : null;
}

function touch(tabs: Tab[], key: string, now: number): Tab[] {
  return tabs.map((tab) => (tab.key === key ? { ...tab, lastActive: now } : tab));
}

// Too many tabs: the least recently used ones go, never the active one nor one with
// unsaved changes (if every tab is like that, the limit is exceeded).
function enforceLimit(state: TabsState): TabsState {
  let tabs = state.tabs;
  while (tabs.length > MAX_TABS) {
    const victim = tabs
      .filter((tab) => tab.key !== state.activeKey && !tab.dirty)
      .sort((a, b) => a.lastActive - b.lastActive)[0];
    if (!victim) break;
    tabs = tabs.filter((tab) => tab !== victim);
  }
  return { ...state, tabs };
}

// Opens (or shows) a tab. A preview replaces the current preview tab in place; opening a
// tab that is a preview without `preview` keeps it open.
export function openTab(state: TabsState, ref: TabRef, options: { preview?: boolean; now: number }): TabsState {
  if (WITH_ID.has(ref.kind) !== Boolean(ref.id)) throw new Error(`Invalid tab ${tabKey(ref)}`);
  const key = tabKey(ref);
  const existing = state.tabs.find((tab) => tab.key === key);
  if (existing) {
    const tabs = touch(state.tabs, key, options.now).map((tab) => (tab.key === key && !options.preview ? { ...tab, preview: false } : tab));
    return { tabs, activeKey: key };
  }

  const tab: Tab = { ...ref, key, preview: Boolean(options.preview), dirty: false, title: null, lastActive: options.now };
  const previewIndex = options.preview ? state.tabs.findIndex((item) => item.preview && !item.dirty) : -1;
  let tabs: Tab[];
  if (previewIndex !== -1) {
    tabs = state.tabs.with(previewIndex, tab);
  } else {
    // New tabs open next to the active one (as in VS Code).
    const activeIndex = state.tabs.findIndex((item) => item.key === state.activeKey);
    tabs = activeIndex === -1 ? [...state.tabs, tab] : state.tabs.toSpliced(activeIndex + 1, 0, tab);
  }
  return enforceLimit({ tabs, activeKey: key });
}

// Shows a tab reached by its address: the existing one, else a new kept-open tab.
export function ensureTab(state: TabsState, ref: TabRef, now: number): TabsState {
  const key = tabKey(ref);
  const existing = state.tabs.some((tab) => tab.key === key);
  return existing ? { tabs: touch(state.tabs, key, now), activeKey: key } : openTab(state, ref, { now });
}

export function activateTab(state: TabsState, key: string, now: number): TabsState {
  if (!state.tabs.some((tab) => tab.key === key)) return state;
  return { tabs: touch(state.tabs, key, now), activeKey: key };
}

export function keepTab(state: TabsState, key: string): TabsState {
  return { ...state, tabs: state.tabs.map((tab) => (tab.key === key ? { ...tab, preview: false } : tab)) };
}

// Closing the active tab shows its right neighbour, else its left one.
export function closeTabs(state: TabsState, keys: string[]): TabsState {
  const closing = new Set(keys);
  const tabs = state.tabs.filter((tab) => !closing.has(tab.key));
  if (state.activeKey === null || !closing.has(state.activeKey)) return { tabs, activeKey: state.activeKey };
  const index = state.tabs.findIndex((tab) => tab.key === state.activeKey);
  const next = state.tabs.slice(index + 1).find((tab) => !closing.has(tab.key)) ?? state.tabs.slice(0, index).reverse().find((tab) => !closing.has(tab.key));
  return { tabs, activeKey: next?.key ?? null };
}

export function updateTab(state: TabsState, key: string, change: Partial<Pick<Tab, "dirty" | "title">>): TabsState {
  return { ...state, tabs: state.tabs.map((tab) => (tab.key === key ? { ...tab, ...change } : tab)) };
}

// Restored from the browser: valid tabs only, nothing left "dirty" (unsaved changes are
// gone with the previous page).
export function restore(value: unknown): TabsState {
  if (!value || typeof value !== "object") return EMPTY;
  const { tabs, activeKey } = value as Partial<TabsState>;
  if (!Array.isArray(tabs)) return EMPTY;
  const valid = tabs
    .filter((tab): tab is Tab => !!tab && (TAB_KINDS as readonly string[]).includes(tab.kind) && WITH_ID.has(tab.kind) === Boolean(tab.id))
    .map((tab) => ({ kind: tab.kind, ...(tab.id && { id: tab.id }), key: tabKey(tab), preview: Boolean(tab.preview), dirty: false, title: typeof tab.title === "string" ? tab.title : null, lastActive: Number(tab.lastActive) || 0 }))
    .slice(0, MAX_TABS);
  return { tabs: valid, activeKey: valid.some((tab) => tab.key === activeKey) ? (activeKey as string) : (valid[0]?.key ?? null) };
}
