# Frontend (`apps/web`) — plan, version 1

The real user interface, replacing the test client for users. Features and rules come from `FEATURE.md` (IDs such as O4, M1); this document describes how they are presented. Status: **steps 1–6 done** (§9), step 7 next.

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

**Step 2 — search, results, offer tab (2026-10-16)**:
* Search (`src/search/`): keywords searched as you type (250 ms pause) and a place picked from suggestions (accessible combobox: arrows, Enter, Escape); "Filters" reveals contract, remote work, publication date, minimum salary, radius and fully-remote (when a place is set), with a counter of active filters. The search lives in the address (`?q=…&locationId=…&location=Lyon…`, defaults left out), so it survives reloads and links; result count and sort (relevance by default).
* Results: TanStack Query (one cache shared with the tabs) and a virtualized list (only visible rows rendered, 20 more loaded while scrolling); previous results stay, dimmed, while a new search loads; skeleton rows on first load; match % with the selected resume (shared formula, FEATURE O4), saved star, "whole area" tag for offers found through their wider area. Click = preview tab, double-click = kept open, resting the pointer on a row loads the offer beforehand.
* Offer tab (`src/offers/`): title (also the tab's), company, place, contract and remote, salary, publication age; Save and tracking status (shown at once, confirmed in the background, undone on failure; saving or tracking keeps a preview tab open); "Generate a resume" (disabled until step 5); original offer link; match panel (score, skills you have, skills to highlight, shared occupation; invitation to upload a resume); skills; description; resumes already generated. Closed and private offers have a banner.
* Descriptions: a small Markdown renderer (headings, lists, bold, italic, http(s) links) producing React elements only — HTML in descriptions stays text. The collector's HTML conversion now keeps a list item's text on its dash when the item wraps a paragraph; the renderer also accepts the older form.
* Speed, measured on the production build (`npm run web:build`, `npx vite preview apps/web` on port 5175) with the real database: results visible about 0.75 s after a cold page load; opening an offer 60–95 ms (first of the session 130–180 ms); 208 KB of compressed JavaScript at first load. The offer tab is part of the first load (a lazy view waits one round on first display); other views' code is fetched when the page is idle.
* Web unit tests run with Vitest (`npm test` runs them after the server tests): tabs, search address, Markdown parsing.
* Seen with real data, outside the frontend: on English offers the skill matching adds noise (e.g. "Recruitment", "rhetoric", "Scratch (computer programming)", a skill shown twice) — to fix in the collector's matcher; it also weighs on the match %.

**Step 3 — accounts (2026-10-16)**:
* One dialog for log in, sign up, forgotten password and new password (`src/auth/`): fields checked with the API's shared rules (email, 10-character password) before sending; API errors translated under the form (wrong password, address taken, too many attempts, invalid link…). Signing up as a guest keeps the guest's data; logging in merges it (FEATURE A2, done by the API).
* After a login, sign-up or logout, every user-dependent answer is fetched again (saved stars, match %…).
* Account menu: log in / sign up for visitors and guests; the address, a dot and "Resend the confirmation email" while it is unconfirmed, log out, log out everywhere, for accounts; theme and language for everyone.
* Guest reminder (FEATURE G1): guests (who exist once they saved something) see a small banner at the bottom of the sidebar; dismissed for a week.
* Email links: `/reset-password?token=…` opens the new password dialog, `/verify-email?token=…` confirms the address (each token used once); the address then goes back to the workspace. The API builds these links from `WEB_BASE_URL`: set it to `http://localhost:5174` to use the web app (default: the test client, 5173).
* Language: an account's language is adopted on login and on a new device; choosing a language saves it to the account.
* Short confirmations as toasts (bottom right, read by screen readers).
* Change password and delete the account come with the Settings tab (step 6).
* Checked end to end in a headless browser against an API on the test database (emails read from MailHog): wrong password, login, logout, guest reminder, sign-up keeping a saved offer, email confirmation link, forgotten password link, account language. Lesson: browser checks must use their own ports (5176 here) — a check that reuses a running 5174 talks to the developer's own API and database.

**Step 4 — Resumes and Photos tabs (2026-10-16)**:
* Resumes tab (`src/resumes/`): the list (selected resume, language, "translation of…", age) with an upload zone (drop or pick a PDF/DOCX; "Reading your resume…" while the AI reads it, about 5 s; then the resume opens with a "check the imported data" banner) and "Create an empty resume"; per resume: select (shown at once), translate into the other language, download the original file, delete (confirmed). The selected resume drives the match % everywhere.
* Editor (`ResumeEditor.tsx`): a structured form over every section of ResumeContent v1 (identity and links, summary, skills with their type, experience with responsibilities and technologies, projects, education, languages, certifications, interests); items added, moved and removed; dates as YYYY or YYYY-MM, "current job"; checked with the API's schema before saving, errors next to the fields; Save or Ctrl+S; unsaved changes mark the tab and closing asks.
* Translation review (FEATURE T1): a translated resume shows each translated field's original below it with "Re-translate" (that field only; the API accepts the T1 fields only), a "check the translation" banner until "Mark as reviewed" (kept in the browser), and "The original resume changed… Translate again" when the source was edited; translating again when a translation exists asks first.
* Photos tab (`src/photos/`): a grid with upload (drop or pick), the selected photo, "No photo", rename in place, delete (confirmed); images from the owner-only API route.
* Generic confirmation dialog (`lib/confirm.tsx`) and translated limits ("Limit reached: 2 at most", plus the account hint for guests).
* Checked in a headless browser against an API on the test database with the real AI (3 small Gemini calls per run): upload of a sample PDF (name, title, 2 jobs, 6 skills read), automatic selection, match % in the results, unsaved-changes dot and close confirmation, required-field error, save, translation into English with 14 originals shown and a re-translated field, delete, photo upload, rename, "No photo". First load 188 KB compressed; the Resumes (7.5 KB) and Photos (2.3 KB) views load on first use or when the page is idle.
* Not done: the optional square crop before a photo upload (FEATURE R6, optional).

**Step 4 additions (2026-10-16)**: photos can be cropped to a square before upload (`photos/CropDialog.tsx`: drag, slider, wheel or +/- to zoom, arrows; "Use the whole photo" sends the file as is; cropped in the browser to at most 1000 px). New resumes are named in the user's interface language ("CV 1" / "Resume 1"; the API reads the user's language, and the web app sends its language as `Accept-Language`, which a guest created by a request gets).

**Step 5 — generation and change review (2026-10-16)**:
* "Generate a resume" in the offer tab opens a dialog (`src/generated/GenerateDialog.tsx`, FEATURE M1): source resume (the selected one by default), AI modifier on/off, strength (light / medium / strong, each with what it does and the sections it modifies, from the settings), template, "keep these choices as defaults". Defaults come from the settings. When the offer and the resume are in different languages: use the user's resume in the offer's language if there is one, translate first (creates the translation, then generates with it), or generate anyway. The offer tab is kept open and the generated resume opens in its tab.
* Generated resume tab (`GeneratedView.tsx`, FEATURE M3, M4): the review on the left — changes grouped by section, a word diff for rewritten texts (removed words in red, added in green; `lib/diff.ts`, tested), added and removed items, reordered lists (old and new order), "Not in your original resume" on skills added by the strong strength, Keep / Reject on each change (shown at once, saved right away; pending counts as kept), Keep all / Reject all globally and per section, "N of M reviewed" with previous / next change; the rendered preview on the right (the API's sandboxed HTML), re-rendered after every decision; template and photo changed without a new generation; PDF download (asks first while changes are pending); delete.
* Generated resumes tab (`HistoryView.tsx`): history, newest first, with template, strength, match % and changes still to review.
* Checked in a headless browser against an API on the test database with the real AI (3 Gemini calls per run): a strong generation in 5 s with 4 changes (2 added skills flagged), the preview, a rejected change re-rendering the preview, Keep all, template and photo changes, the PDF (`Camille-Martin_Brunoy-Digital_2026-10-15.pdf`), the history, the language mismatch with "generate anyway", the photo crop (a 150×150 square after zooming ×2). First load: 220 KB compressed over 10 files (budget 250 KB: to watch in step 7); generation and review views load on first use.
* Not done: editing a generated resume by hand with the full form (FEATURE M3, needs the resume editor to work on generated content) and the "Show original / Show result" toggle of the review (the change cards show both).

**Step 6 — Saved offers, Settings, Add an offer (2026-10-16)**:
* Saved offers tab (`src/saved/SavedView.tsx`, FEATURE O3): filter by status, sort by date saved or last tracking change; per offer: tracking status (menu), dates saved / changed, application date, notes (saved when leaving the field), "no longer available" flag, remove (asks first when there is a status or notes); a click opens the offer. Every change shows at once and refreshes the offer and the results.
* Settings tab (`src/settings/SettingsView.tsx`, S1, S2, L1, A5, A7): generation defaults (AI modifier, strength with what it modifies, template), language and theme, and for accounts: address and its confirmation, change password (other devices logged out), log out everywhere, delete the account (password, then confirmation). Guests are invited to create an account.
* Add an offer tab (`src/offers/AddOfferView.tsx`, O5): an address or the offer's text; the AI reads it, the user checks and completes the fields (`OfferForm.tsx`: title, company, place with suggestions, contract, remote work, salary, address, language, description), the offer is saved privately and opened; an address already known opens that offer; a page that can't be read (login wall, protection) switches to pasting the text. The creator edits a private offer from its tab ("Edit"). The API's extraction answer now includes the detected place (its name, for display).
* Accessibility fixes found by the checks: labels linked to their fields by id (a label wrapping a menu read the options into its name), the tracking menu named "Tracking: …", the radius menu labelled.
* Checked in a headless browser against an API on the test database (1 AI call per run): saved offers (filter, note kept after reload, removal), settings saved, wrong then right current password, interface switched to English, unreadable address → paste, extraction (title, company, Nantes, permanent, 45 000–52 000 read in about 3 s), save and edit of the private offer, known address, account deletion. First load 222 KB compressed over 11 files.
* Every tab kind now has its view; the step placeholders are gone.

