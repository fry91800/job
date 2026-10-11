# Feature specification (MVP)

Reference for implementation. Each feature has an ID used in code reviews, tickets and `claude/DECISIONS.md`. Tables are described in `DATABASE.md`.

Conventions: **Guest** = visitor without an account (server-side guest user). **User** = guest or registered. Limits are configuration values (env/config file), not hard-coded and not stored in the DB; the numbers below are the initial defaults.

---

## G — General principles

### G1. Use without an account
* Every feature except password reset, logout and account deletion works for guests.
* No guest row is created on a simple visit. The guest user and its session are created **lazily** on the first action that writes data (upload resume, save offer, change a setting, generate…). Browsing and searching offers need no session.
* Guests and registered users share the same tables; a guest is a `users` row with no email.

### G2. No data loss when creating an account
* **Sign up while a guest** → the guest row gets an email + password. Same `user.id`, so all resumes, photos, saved offers, generated resumes and settings are kept. The same session continues.
* **Log in to an existing account while a guest with data** → the guest's data is **merged** into the account, then the guest row is deleted (see A2).
* The UI shows a non-blocking reminder to guests who have data ("Create an account to keep your resumes on any device").

### G3. Guest lifecycle
* The guest session lasts 30 days and is extended while the guest is active.
* Guests inactive for 30 days are hard-deleted with their files by a daily job.
* Clearing cookies loses guest data. This is stated in the UI reminder.

### G4. Limits (initial defaults)

| Limit | Guest | Registered |
|---|---|---|
| Resumes stored | 2 | 20 |
| Photos stored | 3 | 10 |
| Resume uploads (AI parse) | 3 total | 20 / day |
| Generated resumes (AI) | 3 total | 30 / day |
| User-added offers (AI extraction) | 3 total | 30 / day |
| Saved offers | 50 | 1 000 |

* Counters are computed from existing rows (`created_at`, including soft-deleted), so deleting does not reset a quota. No separate usage table in the MVP.
* Additional per-IP rate limit on all AI endpoints and on guest creation (prevents quota bypass by clearing cookies).
* When a limit is reached: HTTP 429 with a machine-readable code; for guests the UI suggests creating an account.

### G5. AI usage
* AI is used for: resume parsing (R2), resume generation (M1), user-added offer extraction (O5). Everything else (search, match %) is deterministic.
* Sending resume content to the AI provider is disclosed in the privacy policy.
* AI calls are synchronous in the MVP (loading state in the UI, server timeout 60 s). Nothing is persisted on failure; the user can retry; failures do not count towards quotas.

---

## A — Authentication & account

### A1. Sign up (email + password)
* Input: email, password, password confirmation (client-side only).
* Rules: email trimmed + lowercased, valid format, unique among non-deleted accounts. Password 10–128 chars; no other composition rule; hashed with Argon2id (or bcrypt).
* If the visitor has a guest session → upgrade that row (G2). Otherwise a new user is created.
* A verification email is sent (A6) but the account is usable immediately.
* Edge cases: email already used → generic error "An account with this email already exists" (acceptable leak for a sign-up form; rate-limited). Double submit → unique constraint handles it.

### A2. Log in
* Input: email + password. On success, a new session is created and replaces any guest session in the cookie.
* Generic error message for wrong email or password. Rate limit: 5 failed attempts per email per 15 min, plus per IP.
* **Guest merge**: if the current session belongs to a guest that owns data:
  * resumes, photos, generated resumes, user-added offers → reassigned to the account (if the account's limits would be exceeded, everything is still moved; limits apply to new creations only);
  * saved offers → moved; if both saved the same offer, keep the account's row and append guest notes;
  * settings (template, modifier, selections, last search location) → the account's settings win; the guest's selected resume becomes the account's selected resume only if the account has none;
  * the guest row and its sessions are deleted. All in one transaction.

### A3. Log out
* Deletes the current session and clears the cookie. The visitor becomes anonymous (a new guest is created lazily if they act again). Only for registered users (guests have nothing to log out of).
* **Log out everywhere** (account page): deletes all of the user's sessions, on all devices.

### A4. Password reset
1. User enters email. The response is always "If an account exists, an email has been sent" (no account enumeration). Rate-limited (3/hour/email).
2. A single-use token (1 h validity) is emailed as a link. Issuing a new token invalidates previous ones.
3. User sets a new password → reset token marked used, **all sessions of the user are deleted** (every device is logged out), user is logged in with a new session.
* Edge cases: expired/used token → clear message + link to request a new one. Guest accounts (no email) cannot reset.

### A5. Account deletion
* Registered users can delete their account (password confirmation). Email and password hash are erased immediately, all sessions deleted, data soft-deleted and purged with files after 30 days. Required for GDPR.

### A6. Email verification *(light)*
* Link sent at sign-up (48 h validity), can be resent. Sets `email_verified_at`. Nothing is blocked if unverified in the MVP.

### A7. Change password *(recommended for MVP)*
* Requires the current password. Deletes all the user's other sessions (logs out other devices) and keeps the current one.

---

## S — Settings (user section)

### S1. Resume modifier settings
* `modifier_enabled` (on/off), `strength` (soft / medium / hard), `modifier_config` (which sections the AI may rewrite: summary, title, skills, work experience, projects; exact permissions in DATABASE.md *modifier_config*).
* These are **defaults** for the next generation; the generation screen shows them and allows a one-off override (M1). Overrides are not saved back unless the user ticks "remember".
* Rules applying to all strengths (enforced in prompts and by post-generation validation):
  * never invent employers, job titles, dates, degrees, certifications or contact details;
  * never add or remove work experiences or education entries, and never add responsibilities (reordering and removing responsibilities or highlights is allowed);
  * **soft**: rephrase and reorder to use the offer's vocabulary;
  * **medium**: soft + emphasise relevant work experience and condense the rest (fewer responsibilities), rewrite summary and title freely;
  * **hard**: medium + may add skills from the offer that are plausibly supported by the resume; such additions are flagged as `added_skill` in the review (M4).
* Modifier off → the content is copied as-is and only rendered with the template (no AI call, no AI quota used).

### S2. Templates
* List all available templates (name, preview image, supports photo), ordered by `sort_order`. Public; no session needed.
* Preview: full-size preview image. *(Later: live preview with the user's own resume.)*
* Select a template → saved in `users.template_id`. It is the default for new generations and can be changed per generated resume without regenerating (M3).
* `is_free` is ignored in the MVP (all templates available).
* Retired template (soft-deleted) → disappears from the list; users who had it fall back to the default template; existing generated resumes keep rendering with it as long as its code exists.

---

## R — Resumes & photos (user section)

### R1. List resumes
* Shows name, language, last updated, and which one is **selected**. Sorted by last updated.

### R2. Add a resume
* **Upload** PDF or DOCX (≤ 5 MB, ≤ 10 pages) → text extraction → AI converts to ResumeContent v1 → language detected → resume is **saved immediately** and opened in the edit form with a "check the imported data" banner.
* **Create from scratch** via the same form (empty content; only `basics.fullName` required).
* Parsing normalizes the content: grouped skills are split into one skill per item, "Technologies: …" lines move to `technologies`, "Present" becomes `isCurrent`, empty strings become `null`.
* Name defaults to `Resume {n}` (n = count of user's resumes + 1); editable.
* If the user had no selected resume, the new one becomes selected.
* Edge cases: scanned PDF with no text layer → error "We couldn't read text from this file" (OCR out of scope); password-protected file → error; parse returns invalid JSON → one automatic retry, then error; non-resume document → saved anyway, user corrects (no classifier in MVP).

### R3. Edit a resume
* Structured form over ResumeContent v1 (sections from `DATABASE.md`). Server validates the whole document on save. Language editable.
* On save, resume skills/occupations are re-extracted (M2), which updates match scores.
* No version history for original resumes in the MVP (generated resumes keep a snapshot of what they were based on).

### R4. Select a resume
* Exactly zero or one selected resume per user. The selected resume is used for match % and as the default source for generation.

### R5. Delete a resume
* Soft delete with confirmation. If it was selected → selection cleared (UI suggests picking another). Generated resumes based on it remain intact (they hold a snapshot).
* Re-download of the original uploaded file: available while the resume exists.

### R6. Photos — list, add, rename, select, delete
* Upload JPEG/PNG/WEBP ≤ 5 MB. Server strips EXIF metadata, resizes to max 1000 px, stores in object storage. Name defaults to `Photo {n}`.
* Optional square crop in the UI before upload (client-side).
* Zero or one selected photo. "No photo" is a valid choice. The first uploaded photo is selected automatically.
* Delete: soft delete; if selected → selection cleared. Generated resumes that used it render without a photo once the file is purged.
* Photos are served through an authenticated API route that checks ownership (signed URLs once S3 storage is used) and are never publicly listed.

---

## O — Offers

### O1. Search offers
* Criteria (all optional, combined with AND):
  * **keywords** — matched against title and company name (trigram/ILIKE), and against occupation names linked to the offer;
  * **location** + **radius** (km, default 25; choices 0/10/25/50/100) — chosen via location autocomplete (Geoapify); city → radius on coordinates; region/country → match by admin area / country code; offers without coordinates match on country only when radius is "whole country";
  * **skills** — one or more from the catalogue (autocomplete over `skill_names`); offers matching at least one; ranked by number matched;
  * **company** — text;
  * filters: remote type, contract type, published within (24 h / 7 d / 30 d), minimum salary (only compares offers with the same currency and period; offers without salary are included unless "salary shown only" is ticked).
* Only `is_public = true` and `closed_at IS NULL` offers.
* Sort: most recent (default) or relevance (skill/keyword matches). Sorting by match % is **not** in the MVP (would require scoring every offer).
* Pagination: 20 per page, offset-based.
* Results show title, company, location, remote/contract, salary, published date, saved state, and **match %** if the user has a selected resume (O4).
* The last searched location is saved in `users.search_location_id` for existing users (does not create a guest on its own). Other criteria live in the URL query string (shareable, restorable via browser history).
* Edge cases: no results → suggest widening radius / removing filters; unknown location text without selection → not allowed (must pick from autocomplete).

### O2. Offer detail
* Full description, all fields, match details (O4), buttons: Save / status (O3), Generate resume (M1), Open original (O6), list of resumes already generated for this offer.
* Closed offers are still viewable from saved lists/history with a "no longer available" banner; not reachable from search.

### O3. Saved offers (personal list + application tracking)
* Save / unsave from search results or detail. Saving creates the guest if needed.
* Each saved offer has a status: `saved → applied → interviewing → offer_received`, or `rejected` / `withdrawn` from any state. Any transition is allowed (users correct mistakes); `status_changed_at` is updated on every change; `applied_at` is set the first time status becomes `applied` (editable).
* Free-text notes (≤ 5 000 chars).
* List view: filter by status, sort by saved date / status change date; closed offers flagged.
* Unsave = permanent removal; confirmation if status ≠ `saved` or notes are present.
* Generating a resume for an offer automatically saves it (status `saved`) if not already saved.

### O4. Match percentage
* Deterministic, computed on the fly from the **selected resume** vs the offer (no AI, nothing stored except the snapshot in generated resumes).
* Formula (v1):
  * `skillScore = |offerSkills ∩ resumeSkills| / |offerSkills|`
  * `occupationScore = 1` if resume and offer share an occupation, else `0`
  * if the offer has occupations: `match = round(100 × (0.8 × skillScore + 0.2 × occupationScore))`; otherwise `match = round(100 × skillScore)`
* If the offer has **no extracted skills** → show "Not enough data" instead of a number. No selected resume → show a prompt to add/select one.
* Detail view lists matched skills and missing skills (explainability).
* Later improvements (not MVP): weight required vs optional skills, use `equivalent` skill relationships, seniority.

### O5. Add an offer manually *(user-added offers)*
* Input: an offer URL **or** pasted text (title + description at minimum).
* URL path: normalize the URL → if an offer with that URL exists, reuse it (just save it for the user) → otherwise fetch the page server-side, extract text, AI-extract fields (title, company, location, contract, remote, salary, description), user reviews/edits the fields, then it is saved. If the page cannot be fetched (login wall, bot protection — e.g. LinkedIn), the user is asked to paste the text instead.
* Pasted path: AI-extract fields from the text, user reviews, saved with `url = NULL` (optional URL field).
* Created with `is_public = false`, `source = 'user'`, `created_by_user_id = user`, and automatically added to saved offers. Skills/occupations extracted like collected offers (M2).
* Private offers never appear in search. If the collector later finds the same URL, the offer becomes public (same row; users' data unaffected).
* The creator may edit fields of their private offer; public offers are read-only for users.

### O6. Open original offer
* Opens `offers.url` in a new tab (`rel="noopener noreferrer"`). Hidden when `url` is NULL. No click tracking in the MVP.

---

## M — Resume generation & matching engine

### M1. Generate a resume for an offer
* Entry points: offer detail, saved offer list.
* Preconditions: a source resume (defaults to the selected one; selectable on the screen). If none → prompt to add one.
* Options shown, pre-filled from settings: source resume, modifier on/off, strength, modifiable sections, template, photo (hidden if the template doesn't support photos).
* Process: snapshot source content → if modifier on, AI rewrites allowed sections per S1 rules → server validates output against ResumeContent v1 and the never-change rules (employers, dates, degrees unchanged; no deleted entries) → forbidden modifications are dropped (see M4) → the API builds the change set → save the `generated_resumes` row (with match score snapshot and model id) → open the **review screen** (M4).
* If every proposed change was forbidden or nothing changed, the row is still saved with an empty change set, and the user sees "No modifications were proposed".
* Output language is **always** the source resume language. Generating in another language would make the changes impossible to review; to apply in another language, the user first translates the resume (T1, post-MVP) and generates from the translated resume.
* Offer saved automatically (O3).
* Each generation creates a new row; previous ones for the same offer are kept (history).

### M2. Skill & occupation extraction (supporting feature)
* Resumes: on every save, `skills[].name`, `workExperience[].technologies` and `projects[].technologies` (skills) and `basics.title` + `workExperience[].jobTitle` (occupations) are normalized and looked up in `skill_names` / `occupation_names` for the resume language, then English as fallback. Unknown names are ignored for matching (kept in the JSON). Links are rewritten in the same transaction as the resume save.
* Offers: done by the collector / O5 importer from title + description. Method (dictionary matching vs AI) is a collector decision; output is always catalogue IDs.
* Requires the catalogue (ESCO FR+EN) to be seeded.

### M3. View, edit, download generated resumes
* List per offer (O2) and overall history (newest first): offer title/company, date, template, modified or not, strength.
* View: rendered preview with a badge "N changes to review" while changes are pending.
* Edit: the same structured form as R3, on `generated_content`. Editing a field that has a pending change resolves it as `edited` (M4).
* Change template/photo → re-render only, no AI call, no quota.
* **Download PDF**: rendered on demand from `generated_content` + template + photo (headless browser renderer). File name: `{FullName}_{Company}_{yyyy-mm-dd}.pdf`. PDFs are not stored. If changes are still pending, a confirmation is shown first ("3 changes not reviewed: they will be included").
* Delete: soft delete (still counts towards quota).

### M4. Review AI modifications (accept / reject, like an AI diff in VS Code)
Goal: the user sees exactly what the AI changed and keeps only what they want.

* **What counts as a change**: one change per rewritten text field (summary, title, a responsibility, a project description or highlight), one per added or removed item (skill, responsibility, highlight, project), and one per reordered list. The API computes them by comparing the original with the AI proposal, matching items by their id. The AI does not describe its own changes, so the list cannot leave anything out.
* **Review screen**: the resume is shown section by section, with each change inline: removed words in red and added words in green (word-level diff), and **Accept** / **Reject** buttons on each change. Added skills from the hard modifier carry an extra "Not in your original resume" warning.
  * "Accept all" / "Reject all", globally and per section.
  * Navigation "next / previous change", and a counter "5 of 12 reviewed".
  * Toggle "Show original / Show result".
* **Default state**: changes start as `pending` and **are included** in the result, as in VS Code: the result is what the AI proposed until the user rejects something. Rejecting restores the original value instantly; a rejected change can be accepted again later (no limit).
* Every decision is saved immediately (one API call per decision or batch), so the user can leave and come back.
* **Manual edits**: the user can also edit any field by hand. If that field has a change, the change becomes `edited` and leaves the accept/reject flow.
* **Never shown as changes** (dropped by the API, and logged for prompt improvement): modified companies, job titles, dates, technologies, degrees, institutions, certifications, contact details; added or removed work experiences or education entries; added responsibilities; edits to sections the modifier settings did not allow.
* **Modifier off**: no review step; the generated resume is the original rendered with the template.
* Edge cases: the AI returns an invalid document → one automatic retry, then error (nothing saved, no quota used). The source resume is edited after generation → no effect (the generated resume uses its snapshot).

---

## L — Languages

### L1. Multi-language UI (French + English)
* The whole UI is available in **French and English** from the first release; adding a language later must only require adding translation files.
* Initial language: the user's saved `ui_language` if logged in (guest or registered); otherwise the browser language (`fr*` → French, anything else → English). The choice is kept in a cookie for anonymous visitors.
* A language switcher is always visible. Changing it updates `users.ui_language` when a user row exists.
* Translated: all UI text, enum labels (contract types, statuses, remote types), lookup labels (modifier strengths, templates, by code), validation and API error messages (the API returns error **codes**; the frontend translates them), emails (sent in `users.ui_language`), dates/numbers/currencies formatted per locale.
* **Not** translated: user content (resumes, offers). Offers are shown in their original language.
* Generated resume **templates** print their headings in the resume's language, not the UI language (a French UI user can produce an English resume from an English source).
* URLs are not language-prefixed in the MVP (SPA with client-side switching).

---

## Post-MVP features (designed, not built yet)

### T1. Resume translation
* Translates an **original** resume into another language and creates a **new resume** (`Resume name (EN)`) instead of a generated one. The user can then generate resumes from it like from any resume, and the M4 review applies to that generation as usual.
* Review: because a translation changes every word, a word-level diff is useless. The review shows **original and translation side by side, field by field**, with each field editable and individual items re-translatable. The same never-change rules apply (dates, employers, item count and order preserved), which the API can check because item ids are kept.
* Database impact when built: `resumes.translated_from_resume_id` (nullable FK). No other change.

### H1. Hide offers from search *(undecided)*
* Idea: "Not interested" on a search result hides it for that user. If adopted, the simplest option is a `hidden_offers (user_id, offer_id, created_at)` table, kept separate from `saved_offers` so that hidden offers do not show up in the saved list.

---

## Cross-cutting requirements

* **Authorization**: every user-owned row is accessed through `user_id = currentUser` — never trust IDs from the client alone. Returns 404 (not 403) for other users' rows.
* **Validation**: shared schemas (ResumeContent, modifier_config, search params) used by the API; the frontend may reuse them.
* **Files**: stored on **local disk** behind a storage module whose interface is S3-compatible, so S3 (or MinIO, R2…) can be switched on by configuration when needed (see DATABASE.md *File storage*). Keys are random; files are served only after an ownership check. Files are deleted when their row is purged.
* **i18n**: see L1.
* **Privacy/GDPR**: account deletion (A5), guest purge (G3), EXIF stripping, AI provider disclosure. Data export is post-MVP.
* **Background jobs** (API process or cron): guest purge, deleted-account purge, expired `sessions` and `user_tokens` cleanup.
* **AI providers**: OpenAI and Google Gemini are both candidates. The API calls AI through one small module per task (parse resume, extract offer, generate resume) with the provider chosen by configuration, so the provider can change without touching features. Prompts ask for JSON that is validated against the shared schemas.

---

## Dependencies between features

```text
Catalogue seed (ESCO) ─► M2 extraction ─► O4 match % ─► M1 match snapshot
Locations (Geoapify) ──► O1 search by location
Collector (offers) ────► O1, O2, O3, O6
G1 guest sessions ────► every write feature (R, S, O3, O5, M)
A1/A2 ─────────────────► G2 upgrade/merge
R2/R3 + R4 ────────────► O4, M1
S1 + S2 + R6 ──────────► M1 defaults, M3 rendering
O5 ────────────────────► O3 (auto-save), M1 on private offers
Email provider ────────► A4, A6
M1 ───────────────────► M4 review ─► M3 download
L1 i18n setup ─────────► every UI screen, emails, templates
```

Suggested build order: i18n setup + auth & guest sessions → resumes (form, then upload) → templates & PDF rendering → offers search/detail/saved → catalogue + extraction + match % → generation with modifier + change review → user-added offers.

## Out of scope for the MVP

Paid plans & billing, OAuth/social login, OCR, resume translation (T1, designed below), cover letters, recommendations/alerts, sorting by match %, application reminders, data export, admin UI (seed via scripts), companies table, multiple locations per offer.