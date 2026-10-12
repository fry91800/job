# Decisions log

Why the feature spec (`FEATURE.md`) and database design (`DATABASE.md`) are the way they are. Add new entries at the end; don't rewrite old ones. Mark superseded ones instead.

## Product decisions (confirmed by Francois, 2026-10-11)

| ID | Decision | Consequence |
|---|---|---|
| P1 | Guests are **server-side guest users** (a `users` row without email, identified by a session cookie) | Same tables for everyone; sign-up just fills email/password; `sessions` table needed; guest cleanup job |
| P2 | Resumes are **uploaded (PDF/DOCX) and AI-parsed** into structured JSON, editable in a form; generated resumes are **rendered to PDF on demand** | Only JSON is stored; a strict ResumeContent schema is the backbone; no PDF storage |
| P3 | **No paid plan** in the MVP; **guests are limited** | No billing tables; `templates.is_free` kept but unused; limits in config |
| P4 | **User-added offers** are in scope | `offers.url` nullable, `is_public`, `created_by_user_id` |
| P5 | Saved offers carry an **application status** | New `saved_offers` table with `status`, `notes`, `applied_at` |
| P6 | **Match % is deterministic** (skills/occupations overlap) | Junction tables + catalogue are on the MVP critical path; no AI cost for matching |

## Database changes and rationale

| ID | Change | Why |
|---|---|---|
| D1 | `users.email` and `password_hash` nullable; `last_active_at`, `email_verified_at` added | Guests (P1); guest purge; optional verification |
| D2 | New `sessions` table (server-side sessions, hashed token) — *briefly replaced by D19, restored by D24* | Works identically for guests and users; revocable per device |
| D3 | New `user_tokens` table with a `type` | Password reset + email verification in one small table |
| D4 | New `saved_offers` table | "Save offers to a personal list" had no table; P5 |
| D5 | `user_photos.is_active` removed → `users.selected_photo_id`; same pattern for `users.selected_resume_id` | "Only one active" is guaranteed by the column itself; no partial unique index, no two-row update; "select a resume" needed a home anyway |
| D6 | Junction tables: type fixes (UUID/INTEGER), composite PK, no `updated_at` | Original types were wrong (`resume_id INTEGER` vs UUID resumes, `skill_id TEXT` vs INTEGER skills); composite PK prevents duplicates |
| D7 | `offers.location_id` INTEGER (was TEXT); `locations.countryCode` → `country_code`; `locations.type` added | Type mismatch; naming convention; radius vs area search |
| D8 | `offers`: `company_name`, `language`, `salary_period`, `is_public`, `closed_at` added; `user_id` → `created_by_user_id`; `url` nullable; `remote_type`/`contract_type` as enums | Company search; skill extraction language; salary comparability; private user offers; hide expired offers without deleting history; consistent filter values |
| D9 | `generated_resumes`: `modified` removed; `modification_strength` → `modifier_strength_id` FK; typo `modifer_config` fixed; `resume_id`, `language`, `photo_id`, `match_score`, `ai_model` added | Remove contradictory redundancy; traceability; re-render with another template/photo without regenerating |
| D10 | `templates.program` → `renderer_key`; `free` → `is_free`; `supports_photo`, `sort_order`, `deleted_at` added | Templates are code in the repo, the DB stores a key; boolean naming; retire templates safely |
| D11 | ~~`modifier_strengths.code` added~~ — superseded by D28 | Stable identifier for code/prompts instead of relying on ids or display names |
| D12 | `resumes.source_file_key` added | Keep upload for re-parsing when the parser improves |
| D13 | All timestamps `timestamptz` | Avoid timezone bugs (users in several countries) |
| D14 | `skill_relationships` / `occupation_relationships` kept in the design, **not** in the first migration | Nothing in the MVP reads them ("don't implement future requirements") |
| D15 | Unique constraints: `(source, external_id)` on offers/skills/occupations/locations; `(user_id, offer_id)` on saved offers; name tables | Idempotent collector/imports; no duplicates |
| D16 | Keyword search via `pg_trgm` GIN indexes on title/company | Good enough for MVP, no extra infrastructure; full-text search (tsvector) or a search engine later |
| D17 | No usage/quota table; quotas counted from rows (`created_at`, soft-deleted included) | Fewer tables; revisit if billing or failed-call accounting is needed |
| D18 | ResumeContent v1 JSON schema defined, with `schemaVersion` | Parsing, editing, generation, matching and rendering all depend on one shape |

## Rules worth remembering

* Offers are never deleted (`closed_at` instead) because user history references them.
* Junction rows are derived data: resume links from `resumes.content`, offer links from the collector.
* AI never invents employers, dates, degrees or certifications; hard-mode skill additions are flagged for confirmation.
* Generated resumes snapshot their inputs (content, modifier, match score) so later changes to resumes or settings don't alter history.

## Update 2 — decisions confirmed by Francois (2026-10-11)

| ID | Decision | Consequence |
|---|---|---|
| P7 | ~~Login uses JWT~~ — **superseded by P15** | |
| P8 | Files are stored through an **S3-compatible interface** but on **local disk** until S3 is needed | Storage module with `local` and `s3` drivers; same keys in both (D20) |
| P9 | A generated resume is **always in the source resume's language** | A language change would make AI modifications impossible to check. A separate **resume translation** feature (T1) is designed for after the MVP |
| P10 | The user must be able to **see, accept or reject each AI modification**, as with AI edits in VS Code | New feature M4; change set stored on the generated resume (D21); stable item ids in the resume JSON (D22) |
| P11 | **Multi-language UI**, French and English from the start | `users.ui_language` (D23); i18n rules in FEATURE L1 |
| P12 | Collector sources: to be decided later | No impact on the schema (`source` is free text) |
| P13 | AI providers: OpenAI and/or Google Gemini, not final | Provider chosen by configuration behind one module per AI task; `ai_model` stores `provider:model` |
| P14 | Hiding offers from search: undecided | Designed as H1 (separate `hidden_offers` table if adopted); nothing built |

| ID | Change | Why |
|---|---|---|
| D19 | ~~`sessions` table removed; `users.token_version` added~~ — **superseded by D24** | Pure JWT cannot be revoked. Checking `token_version` during the user lookup the API already does makes logout-everywhere, password reset and account deletion take effect immediately, with no denylist table. Sliding 30-day expiry keeps guests logged in |
| D20 | Storage keys stay driver-independent (`{kind}/{userId}/{uuid}.{ext}`); files served through an authenticated route while on local disk | Switching to S3 later requires copying files only, with no DB migration |
| D21 | `generated_resumes.changes` JSONB (list of changes with `pending/accepted/rejected/edited` status); `generated_content` = original + non-rejected changes | Changes are always loaded with their generated resume, so a JSON list is simpler than a separate table. The API computes the list itself, so it cannot miss a modification |
| D22 | Every array item in ResumeContent has a stable `id`; highlights become `{id, text}`; `skills[].isSuggested` removed | Ids let the API pair original and rewritten items even after reordering. Suggested skills are now `add` changes with an `added_skill` flag |
| D23 | `users.ui_language` (fr/en); lookup tables' `name` columns become admin labels, UI labels come from i18n files by `code`/`renderer_key` | Emails and the UI in the user's language; no translation columns in the DB |

## Update 3 — back to database sessions (2026-10-11)

| ID | Decision / change | Why |
|---|---|---|
| P15 | Login uses **server-side sessions stored in PostgreSQL**, not JWT | Single API, same-site SPA and one database: JWT's benefit (checking a token without a DB read) disappears once revocation requires a user lookup on every request anyway. Sessions give per-device logout, a possible "active devices" list, and simpler security (no signing secret or algorithm pitfalls) |
| D24 | `sessions` table restored (with `user_agent`); `users.token_version` removed | Revocation = deleting rows. Cost: one indexed read per request (same as the JWT design) and a daily cleanup of expired rows. Revisit JWT only for mobile apps, third-party API clients or a separate auth service |

## Update 4 — ResumeContent aligned with the existing resume JSON (2026-10-11)

| ID | Change | Why |
|---|---|---|
| D25 | ResumeContent v1 now uses the project's existing format: `basics.title`, structured `basics.location` (city/region/country), `workExperience` with `jobTitle` and `responsibilities`, skill `category` (technical/soft), `projects` with `technologies`, `link` and `highlights`, `languages[].language` | Keep names already in use; structured location and skill categories are better than the first draft |
| D26 | Adjustments to that format: `id` on every list item; responsibilities and highlights become `{id, text}`; one skill per item instead of `"Node.js, JavaScript"`; `endDate: null` + `isCurrent` instead of `"Present"`; `links` is a list of `{id, label, url}` instead of an object; `null` instead of `""`; `technologies` added to work experience; `lang` removed from the JSON (stored in `resumes.language`); `schemaVersion` added | Ids are required for change review; one skill per item is required for catalogue matching; no untranslatable or mixed-type date values; a single source of truth for language |
| D27 | `modifier_config` keys renamed to the new sections (`summary`, `title`, `skills`, `workExperience`, `projects`) with a permission table; adding is only allowed for skills (hard strength) | Clear limits on what the AI can do per section; adding responsibilities or projects would be inventing experience |

## Update 5 — clarifications (2026-10-11)

No database has been created yet, so `DATABASE.md` now describes the target design directly; "renamed from / new" notes were removed from it (the history stays here).

| ID | Decision / change | Why |
|---|---|---|
| P16 | Only generations that **call the AI** count towards quotas | Modifier off costs nothing |
| P17 | When the offer is in another language than the resume, the user is **asked to translate the resume** (or use an existing resume in that language, or continue anyway) | Generation never changes language (P9); translation is its own reviewable step. Makes T1 a dependency of M1's language check |
| P18 | The **hard** strength may add skills the offer asks for **even if they are not in the resume**; always flagged `added_skill` for review | Product choice: the user decides in the review |
| P19 | Unreviewed changes **count as accepted** (confirmed) | VS Code behaviour; warning before download |
| D28 | `modifier_strengths` table removed → PostgreSQL enum `modifier_strength` (`soft`/`medium`/`hard`) on `users` and `generated_resumes`; rules live in code with the prompt; `generated_resumes.prompt_version` added | Rules evolve with the prompt code that uses them; storing them in the DB let the two drift. `prompt_version` keeps generations traceable |
| D29 | `offers.description` stored as **simplified Markdown** (CommonMark subset), rendered with HTML escaped | Keeps lists/bold/headings readable; Markdown is the standard format for this; safe rendering protects against scraped HTML |
| D30 | Change-set application order defined (replace → remove → add → reorder; restored items go after their original predecessor) | Accept/reject decisions inside the same list must combine predictably |

## Update 6 — translation in the MVP (2026-10-11)

| ID | Decision / change | Why |
|---|---|---|
| P20 | **Resume translation (T1) is part of the MVP** | The M1 language check depends on it; without it users can't apply to offers in another language |
| D31 | `resumes.translated_from_resume_id` (nullable self-FK, SET NULL) + index; translation quota counted from these rows | A translation is a normal resume with a link to its source; no separate table needed |
| D32 | Translation fixes what may change (free text) and what must not (names, companies, technical skills, technologies, dates, item ids/count/order); the API restores forbidden changes | Keeps translations checkable, same principle as the generation rules |

## Update 7 — location search, companies, match % (2026-10-12)

| ID | Decision / change | Why |
|---|---|---|
| D33 | `locations.admin_area` replaced by `region_code`/`region_name` and `county_code`/`county_name`; `location_type` = `city`/`county`/`region`/`country`; index `(country_code, region_code, county_code)` | Area search (department, region, country) must match on stable codes, not on free-text names, and needs two administrative levels |
| D34 | Search rules: radius only for cities; areas match by code; offers located at a larger level are included and labelled; "include remote offers" option | Lets users search a large area, and still shows offers that only state a region |
| P21 | **No `companies` table in the MVP** (C1 describes when to add it); collectors keep source company ids in `raw_data` | `company_name` covers search and display; the table only pays off for dedup, company pages or hide/follow |
| P22 | **Match % computed in the frontend**, with the formula in a new `packages/shared` package also used by the API for the stored snapshot | Instant updates when switching resumes, no server work per search, and one single implementation of the rule |
| D35 | New `packages/shared` (pure TypeScript, no I/O) for schemas, the match formula and shared types; ARCHITECTURE, AI_CONTEXT and README updated | Avoid duplicating business logic between web and api |

## Update 8 — backend before the collector (2026-10-12)

| ID | Decision / change | Why |
|---|---|---|
| P23 | **The backend API is built before the job collector**; the collector is postponed | The API (search first) can be written and tested with seeded offers; collector sources are still undecided (P12) |
| D36 | Development seed in `prisma/seed/`: truncates every table, then inserts locations, a small fr/en skill/occupation catalogue, 200 offers (180 generated with a fixed random seed + 20 hand-written edge cases), users with resumes, saved offers and fixed session tokens | A known, re-creatable data set for writing and testing search, saved offers and match %. Edge cases cover each search rule from DATABASE.md *locations* |
| D37 | Node.js ≥ 20.19 required (raised to 24.7 by D43) (`engines`, `.nvmrc` = 24); npm `db:*` scripts pass `--config prisma7.config.ts` | Prisma 7 does not run on Node 18; the config file has a non-default name |

## Update 9 — constraints and first API route (2026-10-12)

| ID | Decision / change | Why |
|---|---|---|
| D38 | Migration `check_constraints`: the three CHECK constraints and the two "one canonical name" partial unique indexes listed in DATABASE.md | They were documented but missing from the first migration |
| D39 | npm workspaces (`apps/*`, `packages/*`); `src/lib/prisma.ts` moved to `apps/api/src/lib/`; `packages/shared` created with Zod | Matches the documented monorepo layout; Zod is the schema library DATABASE.md suggested |
| D40 | API conventions: `/api` prefix, `session` cookie name, `{error: {code, message}}` error format, Node's test runner against the seeded DB, `tsx` without a build step (details in ARCHITECTURE.md) | Smallest setup that works; a build step can be added for deployment |
| D41 | Search keywords: split on spaces, **every word** must match the title (ILIKE or trigram word similarity ≥ 0.6, which tolerates missing accents and small typos), the company or a linked occupation name | "développeur react" must find "Développeur Front-end React"; scraped titles often lack accents |
| D42 | Search results: wider-area offers are sorted after all other matches whatever the sort; remote offers from elsewhere are sorted with exact matches and labelled `remote`; `distanceKm` is returned for city offers in a city search; a fully remote offer with no location matches any location search | FEATURE O1 ranks wider areas last; remote offers are as relevant as local ones once the user asked for them |

## Update 10 — test client first, full frontend later (2026-10-12)

| ID | Decision / change | Why |
|---|---|---|
| P24 | The React frontend built now is a **minimal test client** (`apps/test-client`) for trying the API by hand; the complete frontend (`apps/web`) is built later | Focus stays on the backend; the API contract can still change, so polished UI work now would be wasted. UI requirements in FEATURE.md (i18n, UX details) apply to `apps/web` only |

## Update 11 — accounts, offer detail, saved offers (2026-10-12)

| ID | Decision / change | Why |
|---|---|---|
| D43 | Passwords hashed with **Argon2id built into Node** (`crypto.argon2`, Node ≥ 24.7), OWASP parameters (19 MiB, t=2, p=1), stored as a PHC string; the seed uses the same function | Argon2id was the documented choice; the built-in version needs no native dependency. The PHC format lets parameters change later |
| D44 | Rate limits (login failures per email 5/15 min and per IP, sign-ups and guest creation per IP) are in memory | One API process in the MVP; no extra table or service |
| D45 | Saved offers are addressed by **offer id** (`PUT/PATCH/DELETE /api/saved-offers/:offerId`); `PUT` is idempotent; `GET` returns an empty list to anonymous visitors instead of creating a guest | One saved entry per user and offer, so the offer id is the natural key; reads never create guests (FEATURE G1) |
| D46 | Login always replaces the current session; when it belonged to a guest, the guest is merged and deleted even if it has no data | One code path; an empty guest has nothing to lose |
| D47 | Location autocomplete searches the `locations` table (prefix, accent-insensitive with the `unaccent` extension, then trigram). Geoapify results will be inserted into `locations` to get an id | Search needs a `locationId` now; the seeded locations are enough until Geoapify is set up |
| D48 | Offer detail takes `?lang=` for skill/occupation names (default: the user's UI language, else `fr`) | Anonymous visitors have no stored language; the web app knows the UI language |
| P25 | Password reset (A4) and email verification (A6) are **postponed** | They need an email provider, not chosen yet |

## Update 12 — resumes, templates, generation without AI (2026-10-12)

| ID | Decision / change | Why |
|---|---|---|
| P26 | **Resume parsing is a placeholder**: every upload returns the same sample resume, whatever the file. The file itself is stored and type-checked | AI parsing is decided later; the rest of the flow (storage, quota, M2, selection) can be built and tested now |
| P27 | **Templates are HTML/CSS printed to PDF by headless Chromium** (`playwright-core`, browser installed with `npm run api:install-browser`) | Easiest way to design good-looking templates; one shared browser keeps it fast |
| D49 | Generation (M1) works with the **modifier off only**; with it on the API answers `501 ai_not_available` | The modifier needs the AI provider; modifier off is fully specified and needs nothing else |
| D50 | Resume upload takes the **raw file as the request body** (`POST /api/resumes/upload`), not multipart; type recognized from the file content (PDF signature, DOCX zip with `word/document.xml`) | No upload library needed; the declared type and file name can't be trusted. The 10-page limit waits for real parsing |
| D51 | Resume editing is a **whole-document PUT** validated by the shared ResumeContent schema; items without an id get one (8 random characters) | Matches R3 ("server validates the whole document on save"); ids are created server-side as DATABASE.md requires |
| D52 | M2 for resumes looks up names in the resume language and English (union), skills from `skills` + `technologies`, occupations from `basics.title` + job titles; feminine job titles added to the seed catalogue | Exact-name lookup as specified; the seeded resumes use feminine titles |
| D53 | The match % formula and catalogue name normalization moved to `packages/shared`; the seed uses the API's extraction | One implementation of each rule |
| D54 | The HTML preview of a generated resume is served with `Content-Security-Policy: default-src 'none'`; Chromium renders with network blocked | Defence in depth behind template escaping: resume text comes from users and, later, from the AI |

## Update 13 — photos and cleanup jobs (2026-10-12)

| ID | Decision / change | Why |
|---|---|---|
| D55 | Photos processed with **`sharp`**: EXIF orientation applied, all metadata removed, longest side ≤ 1000 px, stored as **WebP** (`photos/{userId}/{uuid}.webp`); JPEG/PNG/WEBP recognized from the content; upload body = the raw image (like resumes) | R6 requires EXIF stripping and resizing; sharp is the standard library for it. One output format keeps templates and storage simple |
| D56 | "No photo" = `DELETE /api/photos/selection`; a generated resume's photo can be changed or removed (`PATCH … { photoId }`) | R6 makes "no photo" a valid choice; M3 allows changing the photo without regenerating |
| D57 | Soft-deleted photos keep rendering in generated resumes until purged; a missing file renders without photo | R6 |
| D58 | **Cleanup job** (one function, idempotent): expired sessions; used or expired user tokens; guests inactive 30 days (G3); accounts deleted 30 days ago (A5); soft-deleted photos and resumes after 30 days. Files deleted after their rows. Runs in the API every 24 h, or once with `npm run jobs:cleanup` | FEATURE "Background jobs". In-process scheduling is enough for one API process; use the script from cron when there are several |
| D59 | Soft-deleted **generated** resumes are not purged (only with their user) | They count towards AI quotas (M3) |
| D60 | Purging a soft-deleted resume removes its row, so a guest's lifetime upload count (G4) can go down after 30 days | Accepted: personal data must go; the per-IP rate limit on guest creation still applies |
| D61 | The dev seed also empties the local file storage | Files belong to the rows it truncates |

## Update 14 — user-added offers (2026-10-12)

| ID | Decision / change | Why |
|---|---|---|
| P28 | **Offer extraction is a placeholder** (O5): a URL gives a sample offer, pasted text is split into title (first line) and description. The page is **not fetched** yet | The AI does the real extraction. Fetching user-supplied URLs needs SSRF protection; it is built together with the extractor, since the placeholder would ignore the page |
| D62 | Two steps: `POST /api/user-offers/extract` returns a draft (nothing stored), `POST /api/user-offers` creates the reviewed offer | O5: the user reviews the fields before the offer is saved |
| D63 | A known URL (after normalization) returns `{ existingOfferId }` and saves that offer for the user, **even if it was another user's private offer**; creating with a known URL answers `409 offer_exists` with the id | O5 "reuse it"; knowing the page's URL is enough to see its content anyway |
| D64 | URL normalization in `packages/shared` (`normalizeOfferUrl`): http(s) only, no credentials, scheme/host lowercased, default port and fragment removed, tracking parameters (`utm_*`, `gclid`, `fbclid`…) removed, remaining parameters sorted | The collector must produce the same `offers.url` for the same page |
| D65 | Skills/occupations of user-added offers: dictionary matching of catalogue names as whole words (skills in title + description, occupations in the title) | M2 lets the method be chosen per source; no AI needed. Known limit: short names can match common words ("Go") |
| D66 | User-added offers quota counted from created offers (guest 3 total, registered 30/day), checked at extract and create; extraction also has a per-IP rate limit (`aiPerIp`) | FEATURE G4: AI endpoints are quota-limited and rate-limited per IP |

## Assumptions made (change if wrong)

1. Session token: random 32 bytes, SHA-256 hash stored, sent in an HttpOnly cookie (not `localStorage`), CSRF handled with `SameSite=Lax` + `Origin` check.
2. Location autocomplete uses Geoapify (as in the existing `locations` design).
3. Guest/registered limits in `FEATURE.md` G4 are starting values.
4. AI calls are synchronous (no job queue) in the MVP.
5. A transactional email provider will be chosen for password reset/verification.

## Open questions

1. Hide offers from search (H1): adopt or not?
2. Collector sources and AI provider: deferred, no blocking impact.