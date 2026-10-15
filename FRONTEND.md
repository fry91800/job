# Frontend (`apps/web`) — plan, version 1

The real user interface, replacing the test client for users. Features and rules come from `FEATURE.md` (IDs such as O4, M1); this document describes how they are presented. Status: **step 1 done** (§9), step 2 next.

## 1. Goals

* **A workspace, not a website**: users search on the left and open what they work on in tabs on the right, like files in VS Code. Job hunting is back and forth between offers, a resume and generated versions; tabs make that multitasking natural.
* **Smooth above all** (§5): nothing should feel slow, jumpy or blocked.
* **Open to everyone**: guests see and use the whole workspace right away, with no sign-up wall (`FEATURE.md` G1: every feature works for guests except password and email ones). Restrictions and paid plans come later.
* **Modern and calm** (§4), with a light and a dark theme.
* French and English from the first release (`FEATURE.md` L1).

## 2. Layout

```
┌──────────────────────┬───────────────────────────────────────────────────┐
│ [Resumes][Photos]    │ ┌ Offer: Dev React ×┐┌ Resume (generated) ×┐┌ ⋯ ┐  │
│ [Saved][Generated]   │ ├────────────────────────────────────────────────┤ │
│ [Settings]  Guest ▾  │ │                                                │ │
├──────────────────────┤ │                                                │ │
│ 🔍 keywords          │ │            content of the active tab           │ │
│ 📍 location          │ │                                                │ │
│ [Filters ▾] 2 341 ↕  │ │                                                │ │
├──────────────────────┤ │                                                │ │
│ Dev React · Doctolib │ │                                                │ │
│ Paris · CDI · 82 % ☆ │ │                                                │ │
│ Data Eng. · Alan     │ │                                                │ │
│ …                    │ └────────────────────────────────────────────────┘ │
└──────────────────────┴───────────────────────────────────────────────────┘
```

### 2.1 Sidebar (left)

About 340 px wide, resizable by dragging its edge, collapsible. Three blocks, top to bottom:

1. **Tools and account**: icon buttons with tooltips — Resumes, Photos, Saved offers, Generated resumes, Settings — and the account menu (guest: "Guest", Log in, Sign up; registered: name, Log out, Log out everywhere, account). The menu also holds the theme choice (light / dark / system). Guests with data see the reminder of `FEATURE.md` G1 ("Create an account to keep your resumes on any device"), non-blocking.
2. **Search**: a keyword field and a location field with autocomplete (as in the test client), searching as you type (debounced). A "Filters" button reveals the other filters (contract, remote, salary, published within, distance, include remote); a dot on the button shows that filters are active. Below: the result count and the sort (relevance by default, most recent).
3. **Results**: a compact list — title, company, city, contract, match % (when the user has a resume), saved star. More results load as the user scrolls. The offer open in the active tab is highlighted.

### 2.2 Workspace (right): tabs

* Each tab has an icon for its type, a title and a close button; the active tab is highlighted. Middle-click or the close button closes a tab; closing a tab with unsaved changes asks for confirmation.
* **Preview tab** (as in VS Code): clicking offers in the list shows them in one reused preview tab (title in italics). It becomes a permanent tab when the user double-clicks it, saves the offer, changes its status or generates a resume from it. Browsing 20 offers doesn't open 20 tabs.
* **One tab per thing**: one per offer and per generated resume; Resumes, Photos, Saved offers, Generated resumes and Settings are single tabs (their button brings back the existing tab).
* At most about 10 tabs: opening one more closes the least recently used tab without unsaved changes. A "Close others" / "Close all" menu on tabs.
* **Empty workspace** (first visit, or every tab closed): a short welcome — what the site does, "Upload your resume" (to get match % and generate resumes) and a hint to search on the left.

### 2.3 Tab types

| Tab | Content (`FEATURE.md`) | Opened from |
|---|---|---|
| Offer | Full offer (O6) with its description, match details (O4), Save and status (O3), "Generate a resume" (M1), "Open original", resumes already generated for it | Result list, saved offers, links |
| Generated resume | Preview, change review with accept / reject per change and the "Not in your original resume" warning (M4), template and photo choice, PDF download, edit | "Generate" in an offer tab, generated resumes list |
| Resumes | List, upload, editor (R3), selected resume (R4), translation (T1) | Tools button |
| Photos | List, upload, selected photo (R6) | Tools button |
| Saved offers | Saved offers with status filter and sort (O3); a click opens the offer tab | Tools button |
| Generated resumes | History (M3); a click opens the generated resume tab | Tools button |
| Settings | Resume modifier (strength and what it modifies, S1), template (S2), interface language | Tools button |
| Add an offer | URL or pasted text, extraction, review (O5) | "Add an offer" in the search block |

Dialogs (not tabs) for short actions: log in, sign up, password reset, confirmations.

### 2.4 Addresses and restoring the session

* Every tab has its own address (`/offers/:id`, `/generated/:id`, `/resumes`, `/settings`…); the search is in the query string (`?q=react&location=…`). Refreshing the page or opening a shared link shows the same tab and search.
* The list of open tabs is kept in the browser (local storage) and restored on the next visit.
* The browser's back button goes back to the previously active tab.

### 2.5 Phones (basic)

Below about 768 px: the sidebar is the whole screen (tools, search, results); opening something shows that tab full screen with a back button; open tabs are reachable from a tab switcher button. No resizing or preview tab on phones.

## 3. Behaviour shared by all tabs

* **One source of truth for data**: an offer saved in its tab shows its star in the list at once, a resume edited in the Resumes tab updates the match % shown everywhere, and so on.
* **Instant feedback** on user actions (§5): saving, status changes, accepting or rejecting a change are shown immediately and confirmed by the server in the background; on failure the change is undone with a message.
* **Errors**: the API returns error codes; the frontend shows translated messages next to what failed (not a generic alert). Limits reached (`limit_reached`) show what the limit is and, for guests, that an account raises it.
* **Long AI actions** (resume upload, offer extraction, generation, translation: several seconds): the tab opens immediately with a clear progress state ("Reading your resume…"); the user can keep working in other tabs meanwhile.

## 4. Visual style (proposal)

Modern, calm and dense enough for real work — in the spirit of Linear, Vercel or Raycast: neutral greys, one accent colour, thin borders rather than heavy shadows, generous whitespace inside content, compact lists.

* **Colours**: neutral greys (zinc-like) for surfaces and text; one accent, **indigo** (light theme about `#4F46E5`, dark theme about `#818CF8`), for the active tab, primary buttons, links and focus rings. Semantic colours: green for added text and accepted changes, red for removed text and errors, amber for warnings (added skills, limits). Match %: a small neutral-to-green indicator, never a traffic-light alarm.
* **Light and dark themes**: both designed from the start through colour variables (no hard-coded colours in components). Default: the system's theme; the user can force light or dark (account menu). The choice is applied before the first paint, so the page never flashes the wrong theme.
* **Typography**: Inter (variable font, self-hosted), system fonts as fallback; 14 px base in the workspace, 15–16 px for long reading (offer description, resume preview); tabular numbers for salaries and percentages.
* **Shapes**: 8 px corner radius (6 px for small controls), 1 px borders, shadows only for floating elements (menus, dialogs, tooltips).
* **Icons**: one line-icon set (Lucide), 16–18 px.
* **Density**: list rows about 56 px with two lines of text; content tabs with a comfortable reading width (about 72 characters for descriptions).
* **Accessibility**: contrast AA in both themes, visible focus everywhere, full keyboard use of tabs, lists, menus and dialogs, screen-reader labels on icon buttons.

## 5. Smoothness (requirements)

Smoothness is a requirement, checked like a feature:

* **Instant interactions**: switching tabs, opening an offer already in the list, opening a dialog or a menu: no visible delay (under 100 ms). Offers are prefetched when the pointer rests on a result, so opening them is instant.
* **Tabs keep their state**: switching back to a tab shows it exactly as left (scroll position, form contents, review progress) without reloading.
* **No spinner for short waits**: under about 300 ms nothing is shown; beyond, skeletons with the shape of the content (list rows, offer layout), never a blank screen or a full-page spinner.
* **No layout jumps**: reserved space for content that loads (images, match %, salary); the list doesn't jump when results arrive.
* **Search as you type** without stutter: debounced requests (about 250 ms), previous results kept on screen (dimmed) until the new ones arrive, outdated requests cancelled.
* **Long lists stay fast**: only the visible rows of the result list are rendered (virtualized), so thousands of results scroll at 60 fps.
* **Motion**: short, purposeful transitions (150–200 ms, ease-out) for tabs opening and closing, panels, menus and dialogs; nothing decorative or slow. All motion is reduced when the system asks for it (`prefers-reduced-motion`).
* **Fast first load**: the first screen (sidebar and empty workspace) ships as little code as possible; each tab type's code loads when first opened and is prefetched in the background afterwards. Budget: initial JavaScript under about 250 KB compressed; first screen usable in under 2 s on an average laptop and connection.

## 6. Technical choices (proposed)

* **React 19 + Vite + TypeScript**, as the test client; shared types and the match % formula from `packages/shared`.
* **React Router**: addresses of tabs and search.
* **TanStack Query**: data fetching, cache shared by the list and every tab (§3), prefetching, instant (optimistic) updates, cancelling outdated searches.
* **TanStack Virtual**: virtualized result list.
* **Radix UI primitives** (dialogs, menus, tabs, tooltips, popovers): accessible behaviour without imposing a look; styled with **Tailwind CSS** using theme variables (light / dark).
* **react-i18next**: French and English texts, API error codes translated.
* **Lucide** icons, **Inter** font.
* A small state store for the tabs (open tabs, order, preview tab), persisted in local storage.
* The test client stays as a debugging tool for the API.

## 7. Not in version 1

* Two tabs side by side (split view) and dragging tabs to reorder or split them — the natural next step for comparing an offer with its generated resume.
* Keyboard shortcuts beyond basic navigation, and a command palette.
* Advanced phone features (swipe between tabs, phone-specific editors).
* Restrictions and paid plans (planned later, with the API limits already in place).

## 8. Order of work (proposed)

1. Skeleton: layout, themes, fonts, translations, tab system (open, preview, close, restore, addresses), empty workspace.
2. Search and result list; offer tab.
3. Account: log in, sign up, guest reminder, account menu.
4. Resumes and Photos tabs.
5. Generation: generated resume tab with change review, PDF; Generated resumes tab.
6. Saved offers, Settings, Add an offer.
7. Phone layout, accessibility pass, smoothness pass (measured against §5).

## 9. Progress

**Step 1 — skeleton (2026-10-16)**, `apps/web` (`npm run web:dev`, http://localhost:5174; `npm run web:build`):
* Layout: sidebar (tools, account menu, search fields not yet connected, add an offer), resizable by dragging its edge (double-click: default width) and collapsible to an icon rail; workspace with tab bar and tab contents; empty workspace with the welcome text.
* Tabs (`src/tabs/`): pure model (`model.ts`, unit-tested) and a store kept in the browser — one tab per thing, preview tab (italic, kept open by double-click), new tabs next to the active one, at most 10 (least recently used closed first, never one with unsaved changes), closing the active tab shows its right neighbour else its left one, "Close others / Close all", middle-click closes, confirmation before closing unsaved changes. Every tab has its address (`/offers/:id`, `/generated/:id`, `/generated`, `/resumes`, `/photos`, `/saved`, `/settings`, `/add-offer`); the back button and typed addresses show their tab; open tabs are restored on the next visit. Tabs stay mounted (state kept); each kind of view loads on first use. Every tab shows a placeholder naming the step that builds it.
* Themes: light, dark, system (account menu), applied before the first paint; colour transitions are off during a switch so the page changes at once. Colours only through theme variables (`src/styles.css`).
* French and English (account menu; browser language by default), Inter font, Lucide icons, Radix menus, tooltips and dialogs, reduced motion respected.
* Phones: the list full screen at `/`, a tab full screen with a back button and a switcher between open tabs.
* Checked in a headless browser (both themes, phone size, tab restore and closing, no console error). First load: 149 KB of compressed JavaScript (budget 250 KB, §5).
* Technical note: React Router 7.18 (version 8, released June 2026, can come later). The API accepts state-changing requests from `http://localhost:5174` by default (`WEB_ORIGINS`).

