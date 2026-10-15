import { Briefcase, FileText, History, Image, type LucideIcon, Plus, Settings, Sparkles, Star } from "lucide-react";
import { lazy, type ComponentType } from "react";
import OfferView from "../offers/OfferView";
import type { Tab, TabKind } from "../tabs/model";

// What each kind of tab shows (FRONTEND.md §2.3). Until their step of the plan is built
// (§8), tabs show a placeholder.

export type TabViewProps = { tab: Tab; active: boolean };

type ViewEntry = { icon: LucideIcon; view: ComponentType<TabViewProps>; step: number };

// The offer tab, the most used, is part of the first load (a lazy view waits one round on
// its first display, even preloaded); the others load on first use.
const loaders = {
  placeholder: () => import("./Placeholder"),
};
const placeholder = lazy(loaders.placeholder);

// Once the page is idle, every view's code is fetched in the background, so the first
// tab of each kind opens without waiting for its code (FRONTEND.md §5).
export function preloadViews(): void {
  const run = () => Object.values(loaders).forEach((load) => void load());
  if ("requestIdleCallback" in window) requestIdleCallback(run, { timeout: 3000 });
  else setTimeout(run, 1500);
}

export const VIEWS: Record<TabKind, ViewEntry> = {
  offer: { icon: Briefcase, view: OfferView, step: 2 },
  generated: { icon: Sparkles, view: placeholder, step: 5 },
  resumes: { icon: FileText, view: placeholder, step: 4 },
  photos: { icon: Image, view: placeholder, step: 4 },
  saved: { icon: Star, view: placeholder, step: 6 },
  history: { icon: History, view: placeholder, step: 5 },
  settings: { icon: Settings, view: placeholder, step: 6 },
  "add-offer": { icon: Plus, view: placeholder, step: 6 },
};
