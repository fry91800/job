import { Briefcase, FileText, History, Image, type LucideIcon, Plus, Settings, Sparkles, Star } from "lucide-react";
import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import type { Tab, TabKind } from "../tabs/model";

// What each kind of tab shows (FRONTEND.md §2.3). Views load when a tab of their kind is
// first opened (smaller first load, FRONTEND.md §5). Until their step of the plan is built
// (§8), tabs show a placeholder.

export type TabViewProps = { tab: Tab; active: boolean };

type ViewEntry = { icon: LucideIcon; view: LazyExoticComponent<ComponentType<TabViewProps>>; step: number };

const placeholder = lazy(() => import("./Placeholder"));

export const VIEWS: Record<TabKind, ViewEntry> = {
  offer: { icon: Briefcase, view: placeholder, step: 2 },
  generated: { icon: Sparkles, view: placeholder, step: 5 },
  resumes: { icon: FileText, view: placeholder, step: 4 },
  photos: { icon: Image, view: placeholder, step: 4 },
  saved: { icon: Star, view: placeholder, step: 6 },
  history: { icon: History, view: placeholder, step: 5 },
  settings: { icon: Settings, view: placeholder, step: 6 },
  "add-offer": { icon: Plus, view: placeholder, step: 6 },
};
