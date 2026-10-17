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
| D47 | Location autocomplete searches the `locations` table (prefix, accent-insensitive with the `unaccent` extension, then trigram). Geoapify results are inserted into `locations` to get an id (done: D95–D99) | Search needs a `locationId` now; the seeded locations are enough until Geoapify is set up |
| D48 | Offer detail takes `?lang=` for skill/occupation names (default: the user's UI language, else `fr`) | Anonymous visitors have no stored language; the web app knows the UI language |
| P25 | ~~Password reset (A4) and email verification (A6) are postponed~~ — superseded by P30 | They need an email provider, not chosen yet |

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

## Update 15 — AI layer and Gemini (2026-10-13)

| ID | Decision / change | Why |
|---|---|---|
| P29 | **Gemini** is the first AI provider; the code supports several (`AI_PROVIDER`). **Free tier in development, paid tier before real users** | Free-tier requests may be used by Google to improve its products, which is not acceptable for real resumes (G5) |
| D67 | One function for every AI task: `runAiJson` (instructions + content + Zod schema → validated data, one retry on invalid answer). Providers implement `generateJson` | One place for validation, retries and error mapping; adding OpenAI = one file |
| D68 | Default model `gemini-3.8-flash` (`AI_MODEL`), with low thinking effort for extraction tasks | Fast and cheap; a test parse took 42 s with default thinking. The low-effort setting is not yet verified live (free quota exhausted during setup): run `npm run ai:check` |
| D69 | The provider gets a **simplified JSON Schema** (no lengths, patterns, list sizes; `const` → `enum`); the full Zod schema validates the answer | Gemini answered 400 to the full resume schema and hung on a numeric `const` |
| D70 | Resume parsing sends the **extracted text**, not the file: `unpdf` (PDF, also enforces ≤ 10 pages and detects files without a text layer) and `mammoth` (DOCX). The AI does not produce item ids or `schemaVersion` | Same path for PDF and DOCX, fewer tokens; the R2 errors (scanned, protected, too long) are detected before any AI cost |
| D71 | Retries: temporary errors (503 "high demand", per-minute 429) twice with 2 s / 5 s pauses inside the 60 s budget; an exhausted quota is not retried | 503 happened during setup; retrying a daily quota only wastes time |
| D72 | Tests use a fake provider (`useFakeAi`); `npm run ai:check` makes one real request | No cost, no network, deterministic tests |

## Update 16 — offer extraction with Gemini (2026-10-13)

| ID | Decision / change | Why |
|---|---|---|
| D73 | **SSRF-safe fetcher** (`lib/safe-fetch.ts`, Node built-ins only): http(s), ports 80/443, no credentials; every resolved address must be public (private, loopback, link-local incl. cloud metadata, CGNAT, multicast, reserved, IPv6 local and IPv4-mapped forms refused) — checked in the connection's own DNS lookup; redirects (max 5) re-checked; 10 s, 2 MB, HTML/text only; gzip/deflate/br; declared charset honoured | User-supplied URLs are the classic SSRF entry point; checking at connection time also defeats DNS rebinding |
| D74 | The bot sends an honest User-Agent; sites that refuse it (403, login walls) get `page_unavailable` and the user pastes the text | O5 already plans this fallback; impersonating a browser to bypass protections is not acceptable |
| D75 | The AI receives the page as simplified Markdown of the main content (scripts, navigation, footer… removed, 40 000 characters max) plus the page's schema.org `JobPosting` JSON-LD | Fewer tokens, less noise; JSON-LD is the most reliable source of fields on job sites |
| D76 | URL path: the AI writes the description as simplified Markdown, copied faithfully. Text path: the pasted text is the description, the AI only extracts the other fields | O5 rules; the AI never rewrites what the user pasted |
| D77 | The AI also says whether the content is a job offer (`not_a_job_offer` otherwise). Inconsistent salaries are fixed (min/max swapped) or dropped (no currency or period) instead of failing | Login and error pages must not become offers; one bad field shouldn't lose the rest |
| D78 | Extracted places are matched to `locations` by name, accents ignored (city, then region, then country); otherwise the user picks it | Until Geoapify is set up |
| D79 | The fake AI answers per task name (`ai.with(task, handler, run)` in tests) | Tests of different AI tasks don't interfere |

## Update 17 — generation with the modifier and change review (2026-10-13)

| ID | Decision / change | Why |
|---|---|---|
| D80 | The AI returns **only the allowed sections**, items identified by their ids (summary, title, skills, responsibilities per job, projects with description and highlights); its output schema is built from the modifier settings | Forbidden modifications (companies, dates, education…) cannot even be expressed; less output, faster |
| D81 | The API computes the change set by comparing ids; dropped and logged (count + kind, never content): sections not allowed, unknown ids, added responsibilities/highlights/projects/experiences, new text for an empty field, renamed projects, added skills already present | M4: the API builds the change set, the AI never describes its own changes |
| D82 | Strength enforcement in the API: **soft** = rewrite and reorder only; **medium** = also remove (never every responsibility of a job); **hard** = also add skills (`added_skill`) | S1 wording: soft "rephrase and reorder", medium "condense", hard "may add skills" |
| D83 | Decisions are applied to the **current** generated content (not recomputed from the original), restoring positions with the D30 rules, so manual edits elsewhere survive; a decision request is rejected (`409 conflict`) if the resume changed meanwhile | M3 allows manual edits and M4 decisions on the same document |
| D84 | A manual edit marks `edited` every change whose target changed (text value, item presence/content, list order); edited changes can no longer be decided (`409 change_edited`) | M4 "the manual value wins" |
| D85 | Generation options default to the settings and can be overridden per request (`modifierEnabled`, `modifierStrength`, `modifierConfig`); `remember: true` saves them; no section selected → `400 no_section_selected` | M1 / S1 |
| D86 | AI generations count towards the quota (guest 3 total, registered 30/day, deleted included); modifier off is free; failed AI calls save nothing and use no quota | G4, P16, G5 |
| D87 | Generation uses low thinking effort and temperature 0.4 | Keeps within the 60 s timeout (a parse took 42 s with default effort); some rewording freedom |

## Update 18 — translation, emails, live checks (2026-10-13)

| ID | Decision / change | Why |
|---|---|---|
| P30 | **Email in development: MailHog** (docker-compose, SMTP 1026, UI 8026); production SMTP is configuration only (`SMTP_*`). A4 and A6 are built (supersedes P25) | Catches every email locally, nothing leaves the machine |
| D88 | PostgreSQL published on host port **5433** | A system PostgreSQL in WSL took 5432 and Docker silently failed to publish the container's port |
| D89 | One shared per-IP AI rate limit for upload, extraction, generation and translation (`ai/rate-limit.ts`); it was missing on upload | G4; separate counters per feature multiplied the real limit |
| D90 | Translation: the AI only sees translatable fields (with ids); same items required (else invalid → one retry); merged onto a copy of the source. Never selected automatically; `translation_exists` (409) unless `force`; quota guest 2 / registered 20 per day (translated resumes, deleted included); the resume limit is checked before the AI call | T1, D31, D32; nothing outside the translatable fields can change |
| D91 | "Re-translate a field" returns the text (not saved); allowed paths are a fixed list (technical skills excluded); covered by the per-IP limit only | T1 "small call" |
| D92 | Emails: `nodemailer`, plain text + escaped HTML, in `users.ui_language`; tokens 1 h (reset) / 48 h (verification), SHA-256 stored, previous ones invalidated, single use; reset request answers 202 in every case and sends in the background; reset confirmation logs out every session and logs in (guest merged like A2); verification confirm works without a session | A4, A6, L1, DATABASE.md "user_tokens" |
| D93 | Live checks with Gemini (paid tier): upload 7 s, URL extraction 3 s, generation 5–6 s, translation 3 s. Generation prompt tightened (`2026-10-13b`) after the model added unstated claims ("modern architecture", "code review"): reword and emphasise only, no new tasks/tools/qualifiers, keep punctuation; temperature 0.3 | Truthfulness is the core promise of the modifier |
| D94 | Bug found live: a JSON Schema `required` listing a removed property makes Gemini answer 400; test added | The fake AI doesn't validate schemas like Gemini |

## Update 19 — Geoapify (2026-10-13)

| ID | Decision / change | Why |
|---|---|---|
| D95 | Autocomplete = `locations` table first; Geoapify only when the table has < 5 matches and the query has ≥ 3 characters; answers cached 24 h in memory; countries limited by `GEOAPIFY_COUNTRIES` (default `fr`) | Free tier credits; every Geoapify place is stored, so the table answers more and more searches |
| D96 | Only `city`, `county`, `state` (→ region) and `country` results are kept; streets, districts, postcodes ignored | Search works on these four levels (FEATURE O1) |
| D97 | Region code = Geoapify `iso3166_2` (`FR-IDF`); **département code from a static name → code table** (101 départements + aliases such as "Métropole de Lyon" → 69), postcode prefix as fallback | Geoapify doesn't return département codes, and area search matches on codes |
| D98 | A Geoapify place identical to an existing row (type, name, country, codes) reuses that row; failures and timeouts (3 s) return the local results only | No duplicates (e.g. seeded cities); the autocomplete never breaks because of Geoapify |
| D99 | Offer extraction (O5) looks up places missing from the table with Geoapify (exact name, right level) | Completes D78 |
| D100 | Tests never call Geoapify (key cleared in the test helpers); Geoapify tests use a local fake server with real answers | No credits used, deterministic |

## Update 20 — job collector plan (2026-10-13)

Full plan in `COLLECTOR.md`.

| ID | Decision | Why |
|---|---|---|
| P31 | Goal: the offers people look for, fresh, deduplicated, complete — measured (coverage on an evaluation slice, freshness, duplicates, completeness, dead links, cost) | "All offers" and "best quality" conflict; numbers decide which sources are worth it |
| P32 | **IT first** (ROME family M18 + matching ESCO occupations), **all of France** for API sources; evaluation slice = IT in Île-de-France | API sources cost the same for one city or the country; geography is a measurement tool, not a collection limit |
| P33 | **ROME + ESCO**: ROME and ESCO occupations linked by the official correspondence (`occupation_relationships`), ESCO for skills | ROME is native in France Travail data; ESCO gives multilingual skills |
| P34 | One connector per **kind** of source (official API, ATS adapter, structured-data crawler, aggregator), not per site; order: France Travail → ATS (Greenhouse, Lever, SmartRecruiters, Ashby) → `JobPosting` crawler → aggregators → user-triggered browser extension | Coverage per unit of maintenance; legal sources |
| P35 | **Placeholders, documented but not functional**: per-site crawlers, AI as a source (later only as lead suggestions verified by a real connector), automated logged-in bots | Kept in the design by request; not built because of maintenance, invented offers, and terms of use / EU database right / GDPR |
| P36 | One **ingestion contract** (`CollectedOffer` v1, Zod in `packages/shared`) for every source; `POST /api/collector/ingest` with per-source tokens (or the user's session for the extension), asynchronous through pg-boss | Bots, extension and partners share one format; the API stays fast |
| P37 | Collector in the monorepo (`apps/job_collector`), own process, pg-boss queues on PostgreSQL; raw data kept; one offer with many sources (`offer_sources`); companies table brought forward (C1) | Shares schema and normalization; reprocessing; deduplication across sources |

## Update 21 — collector phase 1 (2026-10-13)

| ID | Decision / change | Why |
|---|---|---|
| D101 | `packages/backend` (`@job/backend`) for server code shared by the API and the collector (Prisma client, matcher, offer links, locations, HTML → Markdown, queues); `apps/api/src/lib/prisma.ts` re-exports its client | No imports from inside another app; `packages/shared` stays I/O-free |
| D102 | Catalogue matching by **token groups** looked up in an in-memory index of all names (refreshed every 10 min or after an import), replacing one regular expression per name; ambiguous words (go, c, r, swift…) only from source labels | ROME + ESCO = tens of thousands of names; same behaviour on the existing tests |
| D103 | ROME data from France Travail's open-data zip (no credentials); ROME ↔ ESCO from the official EURES mapping table (appellation level) aggregated per (ROME occupation, ESCO occupation): `equivalent` for any exact match, else `related`; ESCO occupations missing from the table are created from the mapping's label | Both official; the France Travail ROME API isn't needed for the catalogue |
| D104 | ESCO is imported from the portal's CSV package placed in a local folder (`--esco`) | The portal sends the download link by email; it can't be scripted |
| D105 | IT scope = ROME M18 minus M1808 (cartography) and M1809 (meteorology), with their sub-occupations | Those two belong to M18 in ROME but aren't IT |
| D106 | Source priority for merged offers: ATS 5 > official API 4 > crawler 3 > aggregator 2 > ingest 1 > user-added/placeholder 0; lower-priority sources only fill empty fields; salary merged as one group | COLLECTOR.md §7 |
| D107 | Ingestion endpoint: tokens per source (hashed), ≤ 100 offers / ≤ 5 MB per request, 120 requests/min per token, `source` must match the token; asynchronous through pg-boss (`sendOnly` in the API) | COLLECTOR.md §4 |
| D108 | Deferred from phase 1: AI for missing fields / uncertain duplicates, recruiter-name removal, `isStillOpen` and full-sync closing, company discovery | Need real sources to be designed well |
| D109 | ESCO 1.2.1 imported (fr + en). Manual skills are added only when ESCO lacks them; hyphens split tokens; short all-capital names match only in capitals | ESCO has no React/Node.js/Docker…; ROME writes "full-stack"; ESCO acronyms like "AVEC" matched the word "avec" |

## Update 22 — France Travail closed, sources reordered (2026-10-13)

| ID | Decision | Why |
|---|---|---|
| P38 | France Travail's offer API is **blocked** (closed to new users since early 2026 after abuse by AI services; access on request). The collector no longer starts with it | Our credentials are refused; access requires a request whose outcome is unknown |
| P39 | New order: **ATS adapters + company discovery** (phase 2) → structured-data crawler → public-sector open data (Choisir le service public) and apprenticeship offers (La bonne alternance, if its non-profit terms allow) → aggregators (Adzuna…) and France Travail if access is granted → extension | ATS endpoints were checked to answer with full descriptions and many Paris offers; no single source should be critical |
| P40 | Company discovery from Common Crawl's URL index (columnar files, the query API being overloaded) and Web Data Commons' `JobPosting` extractions | Finds which companies use which ATS / publish structured offers, at scale and from public data |

## Update 23 — collector phase 2 (2026-10-13)

| ID | Decision | Why |
|---|---|---|
| D110 | Adapters for Greenhouse, Ashby, Lever, Lever EU, SmartRecruiters; only offers located in France are collected (tool's country field, else location text) | Product scope is France; boards are worldwide |
| D111 | Contract / remote types only from explicit signals; "full time" alone leaves the contract empty | Avoid inventing CDI for every full-time job |
| D112 | Full sync per board: offers that disappeared from a successfully read board are closed; a failing board closes nothing; 404 → `invalid` | Freshness without false closures |
| D113 | Discovery from Common Crawl's URL index (paged, pauses, retries, saved per prefix); board checks with statuses and re-check delays (7/30/30/90 days); letter-case variants of a board id are `duplicate` | Find French boards from public data while keeping requests polite and the registry clean |
| D114 | Every French offer of a followed company is collected (not only IT); IT share measured by occupation | Long-term goal is all offers; filtering by title at collection would lose offers |
| D115 | A new run closes the connector's older unfinished runs as interrupted | A stopped process must not leave runs "running" forever |
| D116 | An offer missing at its detail request (404 after being listed) is skipped; only the board's list can mark a board `invalid` | Offers are removed between the two requests; one vanished offer must not disable a whole board |

## Update 24 — test database (2026-10-14)

| ID | Decision | Why |
|---|---|---|
| D117 | Tests run against their own database (`job_test` in the same PostgreSQL, or `TEST_DATABASE_URL`) and storage folder, created, migrated and reseeded by `npm test` (`scripts/test.ts`); `api:test` is replaced by `npm test` | The seed empties every table: running tests used to wipe collected offers, discovered boards and the imported catalogue |
| D118 | The Prisma client refuses to start under `node --test` unless the database name ends in `_test` | A test file run by hand cannot reach development data |
| D119 | Tests always use the fake AI provider (`AI_PROVIDER=fake` set by the runner) | No paid model calls from tests |

## Update 25 — full discovery run (2026-10-15)

| ID | Decision | Why |
|---|---|---|
| D120 | No fingerprint (no fuzzy merge) when the département is unknown | One company posted the same title in ~100 towns; at country level they were merged into one |
| D121 | A location text that isn't a known city is used as the city name when it reads like a place; names are compared without accents, case, hyphens or apostrophes | Small towns were falling back to "France" |
| D122 | Sandbox boards are `paused` (never collected or re-checked) | They hold fake offers (382 on one SmartRecruiters sandbox) |
| D123 | SmartRecruiters: known offers with an unchanged release date skip their detail request; each is fetched again about weekly (spread by id) | A full run took 3 h 15 for ~28 000 offers; regular runs only need the new ones |
| D124 | The board registry is exported/imported as a file (boards + companies, no offers); on import the more recent check wins | Discovery and checks take hours; offers are re-collected in one run and expire anyway |
| D125 | IT (ROME M18) occupations from titles come from IT title rules; dictionary M18 matches are kept only when a rule confirms them; the IT scope excludes the weather/climate codes (M1888, M1890, M1891, M1893) | Dictionary matching missed short/English IT titles and its M18 matches were mostly generic names on non-IT jobs (~700 of 1 913) |
| D126 | `collector reenrich` recomputes stored offers' occupations from their titles | Matching rules change; re-collecting would cost hours of requests |

## Update 26 — collector phase 3 (2026-10-15)

| ID | Decision | Why |
|---|---|---|
| D127 | Career sites are boards of the registry (`ats = "careersite"`, slug = start address), collected through the same adapter interface as the ATS (connector kind `crawler`) | One registry, one set of checks, statuses, full sync, closing and export/import |
| D128 | robots.txt obeyed (RFC 9309) by default — `crawler.respectRobotsTxt` (env `CRAWLER_RESPECT_ROBOTS_TXT`) can turn its rules off, pauses and crawl-delay still apply —, one request at a time per host, ≥ 2 s apart or the site's crawl-delay (capped at 30 s); placeholder contact in the user agent until production | Polite crawling of sites we don't have an agreement with |
| D129 | Offer pages from sitemaps (else links); a known page whose sitemap date is unchanged isn't fetched again (weekly refresh); ≤ 1 000 new pages per site and run | Big sites (Thales: 7 000 pages) can't be read in full every day at 2 s per page |
| D130 | The SSRF-safe fetcher moves to `@job/backend`, shared by the API and the crawler | Crawled sites are as untrusted as user-given URLs |
| D131 | Workable and Recruitee get ATS adapters (public APIs); Teamtailor sites are crawled (JobPosting + sitemaps) and discovered by domain | APIs beat crawling when they exist; Teamtailor needs no dedicated code |

## Update 27 — search performance (2026-10-15)

| ID | Decision | Why |
|---|---|---|
| D132 | Keyword search: each word is a union of offer ids from indexed lookups (title ILIKE / word similarity, company ILIKE, offers linked to occupations whose name matches); trigram index on `occupation_names.name`; French/English stop words and H/F markers ignored | With 35 000 offers the OR form was evaluated offer by offer: 2–3 s per word, 26 s for "chef de projet"; now 50–450 ms with the same results |
| D133 | Offer search is sorted by relevance by default (keyword and skill matches first, then most recent); "recent" stays available | Keyword matches through linked occupations are broad; with date order, loosely related offers came first |

## Update 28 — modifier sections follow the strength (2026-10-16)

| ID | Decision | Why |
|---|---|---|
| D134 | The strength decides which resume sections the AI may rewrite (`config.modifier.sectionsByStrength`: soft = summary, skills; medium = + title, work experience; hard = + projects). `config.modifier.userChoosesSections: true` restores the per-user choice (still stored); generated resumes keep recording the sections actually used; GET /api/settings returns the mapping and whether users choose | One choice (the strength) instead of two keeps generation simple for users; the mapping stays easy to tune and the old behaviour one switch away |

## Update 29 — skill matching noise (2026-10-16)

| ID | Decision | Why |
|---|---|---|
| D135 | Skills in offer texts: other-language names only when technical-looking; ambiguous single words never; generic words (recrutement, communication, informatique) only in titles; the same skill in two catalogues gets one id for offers and resumes; `reenrich` recomputes stored offers' skills and quality | Everyday words, the English fallback and boilerplate produced most wrong skills (betting from "Paris", Vue.js from "point de vue"), and duplicates counted twice in the match % |
| D136 | Privacy policy and terms of use as workspace tabs, in both languages, with the operator's details in one placeholder file; signing up shows that it accepts them (links, no checkbox); no cookie banner | Required before opening to the public (GDPR, French LCEN legal notice). The only cookie is the session one and nothing tracks visitors, so no consent is needed; the texts are drafts to have reviewed |
| D137 | Production on one server with Docker Compose: one Dockerfile (targets `api`, `worker`, `web`), TypeScript run with tsx as in development, Caddy in front (automatic HTTPS, strict CSP, HSTS, `/api` forwarded), PostgreSQL never published, migrations applied by the API at startup, uploads and certificates in named volumes; rehearsed locally under another project name | The simplest setup that is safe for a first launch, movable to any host; one image definition for the whole repository; no build step to keep in step with development |
| D138 | The API and the worker refuse to start with missing or development settings in production (HTTP addresses, fake AI, local mail, no crawler contact); JSON logs without personal data or IP addresses; alerts (500 errors, emails not sent, failed cleanup, failed collector runs and jobs) to one webhook, at most once per 15 minutes per kind | Misconfigurations show at deploy time, not as user-facing failures; problems reach the operator without a monitoring service to run |
| D139 | Backups: a daily `pg_dump` (custom format) kept 14 days by a `backup` service, copied off the server by the operator; restore = recreate the database empty, then `pg_restore` (`--clean` fails on pg-boss's partitioned tables) | Simple and tested end to end; the off-server copy depends on the operator's means |
| D140 | The resume templates are created by a migration (they were only in the development seed); `users.template_id` defaults to 1, so without them no user could be created on a fresh database | Found while rehearsing a fresh production database |
| D141 | Raw collected records are pruned (older versions after 90 days, records without offer after 30) by the collector's maintenance; the crawler identifies itself with a contact page (`/bot.html`, served by the site) and an email | Bounded database growth; site owners can see what the bot does and how to stop it |
| D142 | The product is **MonPoste** (monposte.com): page title and favicon, the name on the welcome screen, browser tab titles ("Offer · MonPoste"), emails signed, legal pages, crawler `MonPosteBot` (every collector request names the contact page and address), production examples; www redirects to the bare domain. Package, database and storage-key names stay `job` | The domain was bought; what users and site owners see carries the name, internal names would only cost churn |
| D143 | Match % v2: skill coverage counts up to `skillsForFull` (8) matched skills, and the shown % is `100 × raw^0.6` (100 only for a perfect match); both in `MATCH_CONFIG`, tuned with `npm run match:preview` | Offers list 15–30 skills against ~13 in a resume: on the developer's resume, offers of its own field had a median of 33 %. With v2: median 58 %, top 10 % from 74 %, 9 % green, 8 of 1 283 at 100 % |
| D144 | Bots (proposed, COLLECTOR.md §17): bots send raw offer pages and complete snapshots of the ids they see; the collector extracts (JSON-LD, else AI cached by content hash) and closes offers missing from a complete snapshot or not seen for N days | One place to fix extraction and control AI cost; bots rarely see an offer close, only stop listing it |
| D145 | Discovery reads Common Crawl's index files directly (binary search in `cluster.idx` with range requests, then only the matching blocks) over the last 3 crawls (monthly; 6 for a first run); candidates with French-language pages are marked and checked first. JOIN, Personio, Jobvite and Welcome Kit join Teamtailor as career-site sources (their job pages carry JobPosting); shared sites are crawled within the company's section | The public index service timed out on almost every query, so discovery found little (41 Teamtailor sites of 1 376). A first 6-crawl run found ~24 800 new candidates, 634 with French pages |
| D146 | Talentsoft adapter: list pages for the complete set of offer ids (closing), offer pages read by their field headings with the meta description and content block as fallback; France from the location field, else département/postcode/known city, else a place lookup | Large French employers (EFS, Framatome, Dassault Aviation, Radio France) with no API and no JobPosting; the RSS feed stops at 20 offers; the same pages are used by Belgian and other sites |
| D147 | Choisir le service public read from its website (listing newest first, offer pages), not the open-data file: one registry board, offers carry their employer; daily runs read until known offers and close nothing (`PartialListing`), a weekly full pass closes; kind "aggregator" | The file has no description, no link and lags 4 weeks; the site has ~55 000 offers with texts, deadlines and application links, under Etalab 2.0 |
| D148 | An application link counts for deduplication only when it contains an identifier | Public employers link many offers to the same portal page, which merged unrelated offers |
| D149 | La bonne alternance not collected: its API terms forbid commercializing the data and passing it to third parties, and most of its offers come from partners (France Travail, HelloWork…); a distribution partnership is to be requested first | MonPoste displays offers to the public and plans paid plans |
| D150 | Bot groundwork: the AI code moves to @job/backend (shared by the API and the collector); bots post raw pages (`/api/collector/pages`) and snapshots (`/api/collector/snapshots`); the collector extracts (JobPosting, else AI within a daily budget per source), skips unchanged pages by content hash, closes from complete snapshots with a safety limit, closes offers not seen for 7 days and alerts on quiet sources | One place for extraction and AI cost; bots stay small and can't push malformed offers; a broken bot can't wipe a source |
| D151 | Workday through its career page's own JSON list filtered on France, job details from the public pages' JobPosting; no browser | Its sitemap stops at 100 jobs (Sanofi: 989); the France filter means foreign jobs are never fetched (politer and faster); robots.txt allows it |

## Assumptions made (change if wrong)

1. Session token: random 32 bytes, SHA-256 hash stored, sent in an HttpOnly cookie (not `localStorage`), CSRF handled with `SameSite=Lax` + `Origin` check.
2. Location autocomplete uses Geoapify (as in the existing `locations` design).
3. Guest/registered limits in `FEATURE.md` G4 are starting values.
4. AI calls are synchronous (no job queue) in the MVP.
5. A transactional email provider will be chosen for password reset/verification (DEPLOYMENT.md §5).

## Open questions

1. Hide offers from search (H1): adopt or not?
2. Collector sources and AI provider: deferred, no blocking impact.