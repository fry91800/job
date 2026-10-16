import { Briefcase, FileText, History, Image, type LucideIcon, Plus, ScrollText, Settings, Shield, Sparkles, Star } from "lucide-react";
import { lazy, type ComponentType } from "react";
import OfferView from "../offers/OfferView";
import type { Tab, TabKind } from "../tabs/model";

// What each kind of tab shows (FRONTEND.md §2.3).

export type TabViewProps = { tab: Tab; active: boolean };

type ViewEntry = { icon: LucideIcon; view: ComponentType<TabViewProps> };

// The offer tab, the most used, is part of the first load (a lazy view waits one round on
// its first display, even preloaded); the others load on first use.
const loaders = {
  resumes: () => import("../resumes/ResumesView"),
  photos: () => import("../photos/PhotosView"),
  generated: () => import("../generated/GeneratedView"),
  history: () => import("../generated/HistoryView"),
  saved: () => import("../saved/SavedView"),
  settings: () => import("../settings/SettingsView"),
  addOffer: () => import("../offers/AddOfferView"),
  legal: () => import("../legal/LegalView"),
  // Not tabs, but loaded the same way: the account dialog and the offer edit form.
  authDialog: () => import("../auth/AuthDialog"),
  editOffer: () => import("../offers/EditOffer"),
};
const resumes = lazy(loaders.resumes);
const photos = lazy(loaders.photos);
const generated = lazy(loaders.generated);
const history = lazy(loaders.history);
const saved = lazy(loaders.saved);
const settings = lazy(loaders.settings);
const addOffer = lazy(loaders.addOffer);
const legal = lazy(loaders.legal);

// Once the page is idle, every view's code is fetched in the background, so the first
// tab of each kind opens without waiting for its code (FRONTEND.md §5).
export function preloadViews(): void {
  const run = () => Object.values(loaders).forEach((load) => void load());
  if ("requestIdleCallback" in window) requestIdleCallback(run, { timeout: 3000 });
  else setTimeout(run, 1500);
}

export const VIEWS: Record<TabKind, ViewEntry> = {
  offer: { icon: Briefcase, view: OfferView },
  generated: { icon: Sparkles, view: generated },
  resumes: { icon: FileText, view: resumes },
  photos: { icon: Image, view: photos },
  saved: { icon: Star, view: saved },
  history: { icon: History, view: history },
  settings: { icon: Settings, view: settings },
  "add-offer": { icon: Plus, view: addOffer },
  privacy: { icon: Shield, view: legal },
  terms: { icon: ScrollText, view: legal },
};
