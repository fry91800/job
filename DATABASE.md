# Database design

PostgreSQL + Prisma. The reference schema is `prisma/schema.prisma` (draft reproduced in the appendix). This document explains each table, its constraints, and the rules the API must enforce that the database cannot.

Feature behaviour lives in `FEATURE.md`; the reasoning behind changes is in `claude/DECISIONS.md`.

## Naming conventions

* Use `PascalCase` for Prisma model names (singular).
* Use `snake_case` for PostgreSQL table names (plural) and column names.
* Use `camelCase` for Prisma fields, mapping them to PostgreSQL columns with `@map("column_name")`.
* Use `@@map("table_name")` to map Prisma models to PostgreSQL tables.
* Use `id` for primary keys and `{relatedModel}Id` for foreign keys.
* Use `createdAt`, `updatedAt`, and `deletedAt` for timestamps, mapped to `created_at`, `updated_at`, and `deleted_at`.
* Use descriptive, consistent names; avoid unnecessary abbreviations.
* Keep naming conventions consistent across the entire database.

Additional conventions (new):

* Booleans start with `is_` / `supports_` (`is_free`, `is_public`) except existing `*_enabled` flags.
* All timestamps are `timestamptz` (`@db.Timestamptz`), stored in UTC.
* Enums: Prisma `enum` in PascalCase, values in `snake_case`, mapped with `@@map("snake_case_name")`.
* Primary key types: **UUID** for user-owned or externally visible rows (users, resumes, offers…); **INTEGER autoincrement** for catalogue/lookup rows (templates, skills, locations…).
* Pure junction tables use a **composite primary key** and only `created_at` (rows are inserted or deleted, never updated).
* Soft delete (`deleted_at`) only where users delete their own content and we may need to restore or count it: `users`, `resumes`, `user_photos`, `generated_resumes`, plus admin-managed `templates` and `modifier_strengths`. Every query on these tables must filter `deleted_at IS NULL` unless stated otherwise.

## Entity overview

```text
users ─┬─< sessions
       ├─< user_tokens                (password reset, email verification)
       ├─< user_photos      ◄── users.selected_photo_id
       ├─< resumes          ◄── users.selected_resume_id
       │     ├─< resume_skills >── skills ──< skill_names
       │     └─< resume_occupations >── occupations ──< occupation_names
       ├─< generated_resumes >── offers, templates, modifier_strengths, user_photos
       ├─< saved_offers >── offers
       └─< offers (created_by_user_id, user-added offers)

offers ─┬── locations
        ├─< offer_skills >── skills
        └─< offer_occupations >── occupations

users ── templates, modifier_strengths, locations (settings)
```

## Tables

Legend: **M** = mandatory (NOT NULL). Defaults in the last column.

### users

A person using the app, **registered or guest**. A guest is a row with `email IS NULL`. Signing up fills in `email` and `password_hash` on the same row, so all data is kept.

| Column | Type | M | Default | Notes |
|---|---|---|---|---|
| id | UUID | ✓ | gen | PK |
| email | TEXT | | NULL | Unique. Trimmed + lowercased before storage. NULL = guest |
| password_hash | TEXT | | NULL | Argon2id/bcrypt hash. NULL = guest |
| email_verified_at | TIMESTAMPTZ | | NULL | Not required to use the app in MVP |
| ui_language | VARCHAR(10) | ✓ | `fr` | *New.* `fr` \| `en`. Set from the language in use when the row is created; used for UI and emails |
| last_active_at | TIMESTAMPTZ | ✓ | now | Updated when the session is extended (at most once a day); drives guest cleanup |
| search_location_id | INTEGER | | NULL | FK → locations. Last searched location |
| modifier_enabled | BOOLEAN | ✓ | false | |
| modifier_strength_id | INTEGER | ✓ | 1 | FK → modifier_strengths (seed id 1 = soft) |
| modifier_config | JSONB | ✓ | `{"summary":true,"skills":true,"workExperience":false}` | See *modifier_config format* |
| template_id | INTEGER | ✓ | 1 | FK → templates (seed id 1 = default template) |
| selected_resume_id | UUID | | NULL | FK → resumes, ON DELETE SET NULL. Replaces `is_active`-style flags |
| selected_photo_id | UUID | | NULL | FK → user_photos. NULL = no photo on generated resumes |
| created_at / updated_at / deleted_at | TIMESTAMPTZ | | | |

Constraints & rules
* `UNIQUE (email)`. Postgres treats NULLs as distinct, so any number of guests is fine.
* App rule: `email` and `password_hash` are both NULL or both set (optional DB `CHECK ((email IS NULL) = (password_hash IS NULL))` via raw SQL).
* App rule: `selected_resume_id` / `selected_photo_id` must reference a non-deleted row owned by the same user.
* Account deletion: set `deleted_at`, **immediately** null out `email` and `password_hash` (frees the email for re-signup and removes personal data), delete all sessions; a purge job hard-deletes after 30 days along with stored files.
* Index on `last_active_at` for the guest cleanup job (`email IS NULL AND last_active_at < now() - 30 days`).

### sessions *(new)*

Server-side login sessions, for guests and registered users alike.

| Column | Type | M | Default | Notes |
|---|---|---|---|---|
| id | UUID | ✓ | gen | |
| user_id | UUID | ✓ | | FK → users, CASCADE |
| token_hash | TEXT | ✓ | | Unique. SHA-256 of the cookie value; the raw token is never stored |
| user_agent | TEXT | | NULL | Browser info, kept for a future "active devices" list |
| expires_at | TIMESTAMPTZ | ✓ | | 30 days, sliding |
| last_used_at | TIMESTAMPTZ | ✓ | now | |
| created_at | TIMESTAMPTZ | ✓ | now | |

Indexes: `user_id`, `expires_at`.

How it works
* At login, sign-up or guest creation, the API generates a random 32-byte token, stores its SHA-256 hash, and sends the token in an `HttpOnly; Secure; SameSite=Lax` cookie (never `localStorage`). CSRF: `SameSite=Lax` + `Origin` header check on state-changing requests.
* Each authenticated request hashes the cookie value and loads the session with its user (one indexed read). The request is rejected if the session is missing or expired, or if the user is deleted.
* **Sliding expiry**: when `last_used_at` is more than 1 day old, the API pushes `expires_at` to now + 30 days and updates `last_used_at` and `users.last_active_at`. This limits writes to about one per user per day.
* Logout deletes the current row. "Log out everywhere", password reset/change and account deletion delete all of the user's rows. Deleting a merged guest removes its sessions by cascade.
* A daily job deletes expired rows.

### user_tokens *(new)*

Single-use tokens sent by email.

| Column | Type | M | Default | Notes |
|---|---|---|---|---|
| id | UUID | ✓ | gen | |
| user_id | UUID | ✓ | | FK → users, CASCADE |
| type | `user_token_type` | ✓ | | `password_reset` \| `email_verification` |
| token_hash | TEXT | ✓ | | Unique, SHA-256 of the emailed token |
| expires_at | TIMESTAMPTZ | ✓ | | Reset: 1 h. Verification: 48 h |
| used_at | TIMESTAMPTZ | | NULL | Set on use; a used or expired token is rejected |
| created_at | TIMESTAMPTZ | ✓ | now | |

Index `(user_id, type)`. Issuing a new token of a type invalidates (marks used) the previous unused ones of that type.

### modifier_strengths

Seeded lookup. Unchanged except: `code` (stable identifier used in code, unique), `sort_order`.

| Column | Type | M | Default | Notes |
|---|---|---|---|---|
| id | INTEGER | ✓ | auto | |
| code | TEXT | ✓ | | Unique: `soft`, `medium`, `hard` |
| name | TEXT | ✓ | | Internal/admin label. The UI shows a translated label looked up by `code` |
| rules | TEXT | ✓ | | Prompt rules for the AI |
| sort_order | INTEGER | ✓ | 0 | |
| created_at / updated_at / deleted_at | | | | Never hard-delete (referenced by history) |

### templates

Seeded lookup. Templates are rendering code in the repo; the DB only stores metadata and a key.

| Column | Type | M | Default | Notes |
|---|---|---|---|---|
| id | INTEGER | ✓ | auto | |
| name | TEXT | ✓ | | Internal/admin label. The UI shows a translated label looked up by `renderer_key` |
| is_free | BOOLEAN | ✓ | true | Renamed from `free`. Ignored in MVP (no paid plan) |
| supports_photo | BOOLEAN | ✓ | true | *New.* Photo is omitted when false |
| preview_storage_key | TEXT | ✓ | | Preview image |
| renderer_key | TEXT | ✓ | | *Renamed from `program`.* Unique id of the renderer in code (e.g. `classic`) |
| sort_order | INTEGER | ✓ | 0 | Display order |
| created_at / updated_at / deleted_at | | | | *`deleted_at` new*: retire a template without breaking history |

If a user's `template_id` points to a retired template, the API falls back to the first available template.

### user_photos

| Column | Type | M | Default | Notes |
|---|---|---|---|---|
| id | UUID | ✓ | gen | |
| user_id | UUID | ✓ | | FK → users, CASCADE |
| name | TEXT | ✓ | `Photo {n}` | Generated by the API |
| storage_key | TEXT | ✓ | | Unique. Object storage key |
| mime_type | TEXT | ✓ | | *New.* `image/jpeg`, `image/png`, `image/webp` |
| size_bytes | INTEGER | ✓ | | *New.* After server-side resize |
| created_at / updated_at / deleted_at | | | | |

`is_active` is **removed**: the selected photo is `users.selected_photo_id` (see DECISIONS D5).

### resumes

The user's original resume(s).

| Column | Type | M | Default | Notes |
|---|---|---|---|---|
| id | UUID | ✓ | gen | |
| user_id | UUID | ✓ | | FK → users, CASCADE |
| name | TEXT | ✓ | `Resume {n}` | |
| content | JSONB | ✓ | | **ResumeContent v1** (below), validated by the API on every write |
| language | VARCHAR(10) | ✓ | | BCP 47 (`fr`, `en`, `en-GB`). Detected on parse, editable |
| source_file_key | TEXT | | NULL | *New.* Uploaded PDF/DOCX kept for re-parsing; NULL for form-created resumes |
| created_at / updated_at / deleted_at | | | | |

After every create/update of `content`, the API recomputes `resume_skills` and `resume_occupations` in the same transaction.

### generated_resumes

One AI generation of a resume for an offer. Rows are only written when generation succeeds.

| Column | Type | M | Default | Notes |
|---|---|---|---|---|
| id | UUID | ✓ | gen | |
| user_id | UUID | ✓ | | FK → users, CASCADE |
| offer_id | UUID | ✓ | | FK → offers, RESTRICT (offers are never deleted) |
| resume_id | UUID | | NULL | *New.* Source resume, SET NULL if purged |
| language | VARCHAR(10) | ✓ | | *New.* Always equal to the source resume language. Translation is a separate feature (FEATURE T1) |
| original_content | JSONB | ✓ | | Snapshot of the source resume content |
| generated_content | JSONB | ✓ | | ResumeContent v1. Equals original + every non-rejected change; also directly **editable** by the user |
| changes | JSONB | ✓ | `[]` | *New.* Change set for review (see *Change set* below) |
| modifier_strength_id | INTEGER | | NULL | *Renamed from `modification_strength`, now a FK.* NULL = modifier off |
| modifier_config | JSONB | | NULL | Snapshot (fixes typo `modifer_config`). NULL = modifier off |
| template_id | INTEGER | ✓ | | Template last used to render. Changeable without regenerating |
| photo_id | UUID | | NULL | *New.* Photo last used to render |
| match_score | INTEGER | | NULL | *New.* 0–100 snapshot at generation time |
| ai_model | TEXT | | NULL | *New.* `provider:model` (e.g. `openai:…`, `gemini:…`), for debugging/quality tracking. NULL when the modifier was off |
| created_at / updated_at / deleted_at | | | | |

* The `modified` boolean is **removed**: `modifier_strength_id IS NOT NULL` carries the same information without risk of contradiction. Optional raw-SQL `CHECK ((modifier_strength_id IS NULL) = (modifier_config IS NULL))`.
* Indexes: `(user_id, offer_id)` (list generations for an offer), `(user_id, created_at)` (history + quota counting).
* Quota counting includes soft-deleted rows, so deleting does not refill a quota.

### locations

| Column | Type | M | Default | Notes |
|---|---|---|---|---|
| id | INTEGER | ✓ | auto | |
| provider | TEXT | ✓ | | `geoapify`, `manual`… |
| external_id | TEXT | | NULL | |
| type | `location_type` | ✓ | `city` | *New.* `city` \| `region` \| `country` \| `other`; decides radius vs area matching |
| name | TEXT | ✓ | | |
| country_code | CHAR(2) | ✓ | | *Renamed from `countryCode`* (convention). ISO 3166-1 alpha-2 |
| admin_area | TEXT | | NULL | Region/department |
| latitude / longitude | DOUBLE PRECISION | | NULL | |
| created_at / updated_at | | | | |

`UNIQUE (provider, external_id)`; indexes on `country_code` and `(latitude, longitude)`. Radius search uses a bounding-box pre-filter on that index plus a haversine distance in SQL; PostGIS is a later option if needed.

### offers

| Column | Type | M | Default | Notes |
|---|---|---|---|---|
| id | UUID | ✓ | gen | |
| title | TEXT | ✓ | | |
| company_name | TEXT | | NULL | *New.* Needed for company search. No `companies` table in MVP |
| description | TEXT | ✓ | | Plain text (HTML stripped by collector/importer) |
| language | VARCHAR(10) | | NULL | *New.* Detected; used for skill extraction |
| url | TEXT | | NULL | Unique. Normalized (scheme+host lowercased, tracking params removed). *Now nullable* for pasted-text offers |
| location_id | INTEGER | | NULL | FK → locations. *Type fixed (was TEXT)* |
| remote_type | `remote_type` | | NULL | *Now an enum*: `onsite` \| `hybrid` \| `remote` |
| contract_type | `contract_type` | | NULL | *Now an enum*: `permanent`, `fixed_term`, `temporary`, `freelance`, `internship`, `apprenticeship`, `other` |
| salary_min / salary_max | INTEGER | | NULL | Whole currency units. Check `salary_min <= salary_max` |
| salary_currency | CHAR(3) | | NULL | ISO 4217 |
| salary_period | `salary_period` | | NULL | *New.* `hour` \| `day` \| `month` \| `year`; salary is meaningless without it |
| is_public | BOOLEAN | ✓ | true | *New.* false = user-added private offer, excluded from search |
| source | TEXT | ✓ | | `indeed`, `company_site`, `user`… |
| external_id | TEXT | | NULL | |
| raw_data | JSONB | | NULL | |
| created_by_user_id | UUID | | NULL | *Renamed from `user_id`.* Who added it (user-added offers). SET NULL |
| published_at | TIMESTAMPTZ | | NULL | |
| collected_at | TIMESTAMPTZ | ✓ | now | |
| last_verified_at | TIMESTAMPTZ | | NULL | |
| closed_at | TIMESTAMPTZ | | NULL | *New.* Offer no longer valid → hidden from search, still visible in saved lists/history |
| created_at / updated_at | | | | Offers are never deleted (referenced by user history) |

Constraints & indexes
* `UNIQUE (url)`, `UNIQUE (source, external_id)`.
* `(is_public, closed_at, published_at DESC)` for the default search listing.
* GIN trigram indexes on `title` and `company_name` (`pg_trgm` extension) for `ILIKE '%…%'` keyword search.
* `location_id`, `created_by_user_id`.
* Raw SQL: `CHECK (salary_min IS NULL OR salary_max IS NULL OR salary_min <= salary_max)`.

Offer visibility rule: an offer is visible to a user if `is_public = true`, **or** `created_by_user_id = user`, **or** the user has it in `saved_offers` / `generated_resumes`. When a user adds a URL that already exists, the existing row is reused (see FEATURE O5). When the collector later finds a private offer's URL, it sets `is_public = true` and fills its own `source`/`external_id`.

### saved_offers *(new)*

A user's bookmarked offer, with a lightweight application status.

| Column | Type | M | Default | Notes |
|---|---|---|---|---|
| id | UUID | ✓ | gen | |
| user_id | UUID | ✓ | | FK → users, CASCADE |
| offer_id | UUID | ✓ | | FK → offers, RESTRICT |
| status | `saved_offer_status` | ✓ | `saved` | `saved`, `applied`, `interviewing`, `offer_received`, `rejected`, `withdrawn` |
| notes | TEXT | | NULL | Max 5 000 chars (API) |
| applied_at | TIMESTAMPTZ | | NULL | Set automatically when status first becomes `applied`; editable |
| status_changed_at | TIMESTAMPTZ | ✓ | now | |
| created_at / updated_at | | | | Unsave = hard delete |

`UNIQUE (user_id, offer_id)`, index `(user_id, status)`.

### skills, skill_names, occupations, occupation_names

Kept as designed. Changes:
* `UNIQUE (source, external_id)` on `skills` and `occupations`.
* `UNIQUE (skill_id, language, normalized_name)` and index `(language, normalized_name)` on name tables (lookup path for extraction).
* App rule: at most one `is_canonical = true` per `(skill_id, language)` (optional partial unique index via raw SQL).
* Description of `name` corrected: `name` is the display form; `normalized_name` is the lookup form (trim, lowercase, collapse spaces, NFKC).

### resume_skills, offer_skills, resume_occupations, offer_occupations

Junction tables. Changes:
* **Type fixes**: `resume_id`/`offer_id` are UUID (were INTEGER); `skill_id`/`occupation_id` are INTEGER (were TEXT).
* Composite PK (`resume_id, skill_id`) etc. instead of a surrogate `id`; reverse index on the second column.
* Only `created_at` (no updates on junction rows).
* Rows are **derived data**: resume links are recomputed from `resumes.content`; offer links are written by the collector/importer. Neither is edited directly by users.

### skill_relationships, occupation_relationships — *post-MVP*

Kept in the design but **not created in the first migration** (nothing in the MVP reads them). When added: composite PK `(skill_id, related_skill_id, relationship_type)`, `relationship_type` enum, app rule `skill_id <> related_skill_id`, and store `equivalent` in both directions.

## JSON formats

### ResumeContent v1 (`resumes.content`, `generated_resumes.original_content` / `generated_content`)

Based on the format already used in the project, with the changes listed in `claude/DECISIONS.md` (D25).

```jsonc
{
  "schemaVersion": 1,
  "basics": {
    "fullName": "string",                       // required
    "title": "string | null",                   // e.g. "Fullstack Software Engineer"
    "email": "string | null",
    "phone": "string | null",
    "location": {                               // or null
      "city": "string | null",
      "region": "string | null",
      "country": "string | null"
    },
    "links": [{ "id": "string", "label": "string", "url": "string" }]   // label: "LinkedIn", "GitHub", "Portfolio"…
  },
  "summary": "string | null",
  "skills": [{
    "id": "string",
    "name": "string",                           // ONE skill per item ("Node.js", not "Node.js, JavaScript")
    "category": "technical | soft"
  }],
  "workExperience": [{
    "id": "string",
    "jobTitle": "string",
    "company": "string",
    "location": "string | null",
    "startDate": "YYYY | YYYY-MM | null",
    "endDate": "YYYY | YYYY-MM | null",         // null + isCurrent=true for a current job (never "Present")
    "isCurrent": false,
    "responsibilities": [{ "id": "string", "text": "string" }],
    "technologies": ["string"]                  // replaces the "Technologies: …" responsibility line
  }],
  "projects": [{
    "id": "string",
    "name": "string",
    "description": "string | null",
    "technologies": ["string"],
    "link": "string | null",                    // null, never ""
    "highlights": [{ "id": "string", "text": "string" }]
  }],
  "education": [{
    "id": "string",
    "degree": "string",
    "institution": "string",
    "location": "string | null",
    "startDate": "YYYY | YYYY-MM | null",
    "endDate": "YYYY | YYYY-MM | null",
    "description": "string | null"
  }],
  "languages": [{ "id": "string", "language": "string", "level": "string | null" }],
  "certifications": [{ "id": "string", "name": "string", "issuer": "string | null", "date": "YYYY | YYYY-MM | null" }],
  "interests": ["string"]
}
```

Rules
* Every array may be empty; unknown keys are rejected. "No value" is always `null`, never `""`. The API validates with a single shared schema (e.g. Zod) used by parsing, editing, generation and change review.
* `schemaVersion` allows later migrations of stored JSON without a DB migration.
* **No language field in the JSON**: the language is `resumes.language` (one source of truth).
* **Item ids**: every object in an array has a short random `id` (e.g. 8 chars), unique within the document, created by the API when the item is created and never changed. The AI must return the ids it received; new items get no id and the API assigns one. Ids let the API pair an original item with its rewritten version even when items are reordered, which change review (M4) depends on. `technologies` and `interests` stay plain string lists: they are not reviewed item by item.
* **Dates**: `YYYY` or `YYYY-MM`. `isCurrent: true` requires `endDate: null`. `startDate <= endDate` when both are set.
* **Skills**: one skill per item, so each one can be looked up in the catalogue. Templates may group them by `category` and print them on one line. Matching (M2) uses `skills[].name` plus `workExperience[].technologies` and `projects[].technologies`; `soft` skills are kept but count only if they exist in the catalogue.
* **Parsing (R2)**: the AI is asked to split grouped skills ("Node.js, JavaScript"), move "Technologies: …" lines into `technologies`, turn "Present"/"Aujourd'hui" into `isCurrent`, and turn `""` into `null`.
* Section headings ("Work experience", "Expérience professionnelle"…) are **not** stored; the template prints them in the resume language at render time. The photo is not part of the content either; it is attached at render time.

### modifier_config (`users.modifier_config`, `generated_resumes.modifier_config`)

Which sections the AI may rewrite. Keys are a fixed list; missing keys mean `false`.

```json
{ "summary": true, "title": false, "skills": true, "workExperience": false, "projects": false }
```

| Key | What the AI may do when `true` |
|---|---|
| `summary` | Rewrite `summary` |
| `title` | Rewrite `basics.title` |
| `skills` | Rename, reorder and remove skills; **add** skills only with the hard strength (flagged `added_skill`) |
| `workExperience` | Rewrite responsibility texts; reorder and remove responsibilities |
| `projects` | Rewrite `description` and highlight texts; reorder and remove highlights; reorder and remove whole projects |

**Never modifiable**, whatever the settings: the rest of `basics` (name, contact details, location, links), job titles, companies, locations, all dates, `technologies` lists, `education`, `languages`, `certifications`, `interests`; work experiences and education entries can never be removed or added.

### Change set (`generated_resumes.changes`)

The AI's modifications, stored as a list of reviewable changes (see FEATURE M4). The API computes it by comparing `original_content` with the AI's proposal, matching array items by `id`. The AI never writes it directly.

```jsonc
[
  {
    "id": "c1",                                  // unique within the list
    "op": "replace",                             // replace | add | remove | reorder
    "path": "workExperience[id=w1].responsibilities[id=r1].text",
    "before": "Designed and maintained two web applications for the company.",   // null for add
    "after": "Designed and maintained two Node.js/PostgreSQL web applications used across the company.",  // null for remove
    "status": "pending",                         // pending | accepted | rejected | edited
    "flag": null                                 // null | "added_skill" (a skill not in the original resume)
  }
]
```

* **Paths** use the section names of ResumeContent and select array items by id: `summary`, `basics.title`, `skills[id=s3]`, `workExperience[id=w1].responsibilities[id=r2].text`, `projects[id=p1].description`, `projects[id=p1].highlights` (for a reorder).
* **Granularity**: one change per rewritten text field, one per added or removed item, and one `reorder` per list whose order changed (`before`/`after` are lists of item ids).
* **Allowed operations** are exactly those in the modifier_config table above. Anything else in the proposal (changed dates, companies, degrees, a removed work experience, an added responsibility…) is a violation: the API drops it and logs it. It is never shown as a change.
* **Applying changes**: `generated_content` = `original_content` with every change whose status is not `rejected` applied. The API recomputes and saves it whenever a status changes, in the same update.
* **`edited`**: when the user edits a field by hand that has a change, the change becomes `edited` (resolved, and the manual value wins). It can no longer be accepted or rejected.
* Empty list (`[]`) when the modifier was off.
* The text diff shown in the UI (word-level highlighting between `before` and `after`) is computed by the frontend and is not stored.

## File storage

Files never go in the database; tables store a **storage key** (`user_photos.storage_key`, `resumes.source_file_key`, `templates.preview_storage_key`).

* The API accesses files through a small storage module with two implementations behind the same functions (`put`, `get`, `delete`, `getReadUrl`):
  * **local disk** (MVP and development): files under a configured folder (`STORAGE_LOCAL_DIR`), served only through an authenticated API route;
  * **S3-compatible** (later, when needed): same keys, objects in a bucket, served with short-lived signed URLs.
* The storage module is chosen by configuration (`STORAGE_DRIVER=local|s3`). Keys have the same format in both, so moving files between them needs no database change.
* Key format: `{kind}/{userId}/{uuid}.{ext}` (e.g. `photos/…/….webp`, `resume-sources/…/….pdf`); template previews: `templates/{rendererKey}.png`.
* User files are never publicly listed or served without an ownership check.

## Languages (i18n)

* **UI**: French and English from the start. All UI text, enum labels (contract type, status…), lookup labels (modifier strengths, templates) and API error messages are translated by the frontend from i18n files. The API returns codes, not sentences. Emails are rendered in `users.ui_language`.
* **Content** (resumes, offers) keeps its own language (`resumes.language`, `offers.language`), independent of the UI language.
* **Templates** print section headings in the **resume's** language, so every template ships with fr and en heading strings.
* **Catalogue**: skill/occupation names are imported in fr and en; search and autocomplete use the UI language, with the other language as a fallback.

## Things Prisma cannot express (raw SQL in migrations)

1. `CREATE EXTENSION IF NOT EXISTS pg_trgm;` (declared via `postgresqlExtensions`).
2. CHECK constraints: users email/password pairing; offers salary range; generated_resumes modifier pairing.
3. Optional partial unique index: one canonical name per `(skill_id, language)` / `(occupation_id, language)`.

## Seed data (required)

* `modifier_strengths`: `soft` (id 1), `medium`, `hard`.
* `templates`: at least one (id 1 = default).
* Skills/occupations: ESCO import (FR + EN names) — needed before matching or offer skill extraction works.

## Appendix — draft `prisma/schema.prisma`

The full draft is saved in the project as `prisma/schema.prisma`. Copy it into the repo when starting the migration work. It was reviewed by hand but has not yet been run through `prisma validate`, so run that first.