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
| D11 | `modifier_strengths.code` added | Stable identifier for code/prompts instead of relying on ids or display names |
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

## Assumptions made (change if wrong)

1. Session token: random 32 bytes, SHA-256 hash stored, sent in an HttpOnly cookie (not `localStorage`), CSRF handled with `SameSite=Lax` + `Origin` check.
2. Location autocomplete uses Geoapify (as in the existing `locations` design).
3. Guest/registered limits in `FEATURE.md` G4 are starting values.
4. AI calls are synchronous (no job queue) in the MVP.
5. A transactional email provider will be chosen for password reset/verification.
6. Pending AI changes are **included** in the result until rejected (VS Code behaviour), with a warning before download.

## Open questions

1. Hide offers from search (H1): adopt or not?
2. Collector sources and AI provider: deferred, no blocking impact.