# Job collector

Plan and reference for `apps/job_collector`: the process that finds job offers and stores them in the shared database. Decisions are logged in `claude/DECISIONS.md` (Updates 20–21).

**Status: phase 1 (foundations) done** — see §13. Phase 2 (France Travail) is next.

## 1. Goal

**Collect the offers people actually look for, each one fresh, without duplicates and with complete fields.** "As many offers as possible" and "the best data quality" pull in opposite directions, so every source is judged on both, with numbers (section 9).

Scope order:

* **IT first.** ROME 4.0 family M18 (information systems and telecommunications) **without M1808 (cartography) and M1809 (meteorology)**: the parent occupations M1801–M1807 and M1810 and their sub-occupations (M1811–M1896, each with `code_rome_parent`), 584 appellations; plus the matching ESCO occupations. Sources are chosen and tuned for IT first; the architecture is not IT-specific.
* **All of France from the start** for API sources (the whole country costs about the same as one city). Geography is not a collection limit.
* **Evaluation slice: IT jobs in Île-de-France.** Coverage and quality are measured there first (section 9), to rank sources and find gaps.

## 2. Principles

* **One connector per kind of source, not per website.** One adapter for a recruiting tool (Greenhouse, Lever…) covers every company using it; one structured-data crawler covers every career page publishing schema.org `JobPosting`. Per-site code is a last resort.
* **Sources that allow it.** Official APIs, public endpoints meant for job boards, structured data published for search engines, partnerships. For every source: terms of use checked, `robots.txt` respected, rate limits respected, an honest User-Agent, and attribution or links back when the terms ask for them (section 10).
* **AI is a processor, not a source** (for now): it fills in fields that structured data doesn't give, classifies occupations, finds skills when dictionary matching fails, and judges uncertain duplicates. An AI that "lists offers" invents them; see the placeholder in 5.7.
* **Keep the raw data.** Every record is stored as received, so it can be reprocessed when the normalization or the extraction improves.
* **Reliable, repeatable jobs.** Connectors are deterministic modules with a schedule, not autonomous AI agents.
* **Same rules as the API.** URLs normalized with `normalizeOfferUrl`, catalogue names with `normalizeCatalogueName`, descriptions as simplified Markdown (DATABASE.md), personal data removed.

## 3. Architecture

```text
                    ┌──────────── apps/job_collector (own process) ────────────┐
Sources ──► Connector ──► raw record ──► Pipeline ─────────────────────────────►│──► PostgreSQL
 (APIs,     (one per       (stored        normalize → validate → deduplicate   │    (offers,
  ATS,       kind of        as is)        → enrich → upsert → close expired    │     offer_sources,
  career     source)                                                           │     raw_offers…)
  pages…)                                                                      │
                    └──────────────────────────────────────────────────────────┘
API (apps/api) ── POST /api/collector/ingest ──► queue (pg-boss) ──► Pipeline
```

* **Location**: `apps/job_collector` in the monorepo, deployed as its own process. It shares `prisma/schema.prisma` and `packages/shared` (ingestion contract, URL and catalogue name normalization).
* **Scheduling and queues**: [`pg-boss`](https://github.com/timgit/pg-boss), a job queue stored in our PostgreSQL: cron schedules per connector, retries with backoff, one queue per pipeline stage. No new infrastructure.
* **Layout**:

```text
apps/job_collector/src/
├── connectors/
│   ├── france-travail/        # phase 2
│   ├── ats/                   # phase 3: greenhouse.ts, lever.ts, smartrecruiters.ts, ashby.ts…
│   ├── jsonld-crawler/        # phase 4
│   ├── aggregators/           # phase 5
│   └── placeholders/          # site-crawler.ts, ai-source.ts, logged-in-bot.ts (5.7)
├── pipeline/                  # normalize, validate, dedupe, enrich, upsert, close
├── catalogue/                 # ROME + ESCO import (phase 1)
├── companies/                 # company registry and ATS discovery
├── runs/                      # run records and statistics
└── main.ts                    # worker: schedules connectors, consumes queues
```

### Connector interface

```ts
interface Connector {
  key: string;                   // "france-travail", "greenhouse", … (= offer_sources.source)
  kind: "api" | "ats" | "crawler" | "aggregator" | "ingest" | "placeholder";
  schedule: string | null;       // cron expression; null = triggered (ingest) or disabled
  rateLimit: { requests: number; perMs: number };

  // Collects records changed since `cursor` (incremental when the source allows it).
  // Yields raw records with their mapping to the ingestion contract; returns the next cursor.
  collect(context: RunContext): AsyncGenerator<CollectedRecord, string | null>;

  // Optional: is this offer still open at its source? (used to close expired offers)
  isStillOpen?(externalId: string, context: RunContext): Promise<boolean>;
}

type CollectedRecord = { raw: unknown; offer: CollectedOffer };   // CollectedOffer: section 4
```

Every run is recorded (`collector_runs`): connector, start/end, cursor, counts (received, new, updated, duplicates, invalid, closed), errors. A connector that fails repeatedly is paused and reported.

## 4. Ingestion contract

The one format every source writes to: connectors, the ingestion endpoint (bots, browser extension, partners), and later user-added offers (O5). It will live in `packages/shared/src/collector/contract.ts` as a Zod schema, with its JSON Schema exported for external tools.

### `CollectedOffer` (version 1)

| Field | Type | Req. | Notes |
|---|---|---|---|
| `contractVersion` | `1` | ✓ | |
| `source` | string | ✓ | Connector key (`france-travail`, `greenhouse`…) |
| `externalId` | string | ✓ | Offer id at the source, stable across updates |
| `url` | string \| null | | Public page of the offer (normalized by the pipeline) |
| `applyUrl` | string \| null | | Where to apply, if different |
| `title` | string | ✓ | As published |
| `company` | object \| null | | `{ name, siren?, siret?, website?, logoUrl?, atsSlug? }`; `null` for anonymous offers |
| `location` | object \| null | | `{ raw?, city?, postcode?, countyCode?, regionCode?, countryCode?, latitude?, longitude? }`; at least `raw` or `city`/`postcode`/`countryCode` |
| `remote` | `onsite` \| `hybrid` \| `remote` \| null | | |
| `contractType` | contract type enum \| null | | Same values as `offers.contract_type` |
| `salary` | object \| null | | `{ min?, max?, currency, period, raw? }`; `raw` keeps the original text ("45-55 k€ brut") |
| `description` | object | ✓ | `{ format: "markdown" \| "html" \| "text", content }`; HTML is converted to simplified Markdown by the pipeline |
| `language` | `fr` \| `en` \| string \| null | | Detected by the pipeline if missing |
| `occupations` | array | | `[{ scheme: "rome" \| "esco", code, label? }]` |
| `skills` | array | | `[{ scheme?: "esco" \| "rome", code?, label }]`; labels without codes are matched by the pipeline |
| `experienceLevel` | string \| null | | As given by the source (raw) |
| `publishedAt` | ISO date \| null | | |
| `expiresAt` | ISO date \| null | | |
| `collectedAt` | ISO date | ✓ | |

Rules:

* **Personal data is not collected.** Recruiter names, emails and phone numbers in the fields or the description are removed by the pipeline (GDPR); the contract has no field for them.
* Unknown values are `null`, never invented. Raw text versions (`salary.raw`, `location.raw`) are kept when the structured value is uncertain.
* The raw payload is never part of the contract: it is stored separately (`raw_offers`).

Example:

```json
{
  "contractVersion": 1,
  "source": "france-travail",
  "externalId": "184XYZK",
  "url": "https://candidat.francetravail.fr/offres/recherche/detail/184XYZK",
  "applyUrl": null,
  "title": "Développeur Full Stack React / Node.js (H/F)",
  "company": { "name": "Cloudine", "siret": "12345678900012" },
  "location": { "raw": "44 - NANTES", "city": "Nantes", "postcode": "44000", "countyCode": "44", "countryCode": "FR", "latitude": 47.218, "longitude": -1.553 },
  "remote": "hybrid",
  "contractType": "permanent",
  "salary": { "min": 45000, "max": 55000, "currency": "EUR", "period": "year", "raw": "Annuel de 45000 Euros à 55000 Euros" },
  "description": { "format": "text", "content": "Cloudine, éditeur SaaS nantais…" },
  "language": "fr",
  "occupations": [{ "scheme": "rome", "code": "M1805", "label": "Études et développement informatique" }],
  "skills": [{ "label": "React" }, { "label": "Node.js" }],
  "experienceLevel": "3 ans",
  "publishedAt": "2026-10-10T09:00:00Z",
  "expiresAt": null,
  "collectedAt": "2026-10-13T06:00:00Z"
}
```

### Ingestion endpoint

`POST /api/collector/ingest`, in the API, for everything that isn't a scheduled connector (bots, browser extension, partner feeds):

* **Auth**: a per-source token (`Authorization: Bearer …`), stored hashed in `collector_tokens` with its source key and limits. The user-triggered browser extension (5.6) uses the user's session instead, and its offers are private like O5.
* **Body**: `{ "offers": CollectedOffer[] }`, at most 100 per request, each validated against the contract.
* **Response**: per offer, `accepted` (queued) or `rejected` with the validation errors. Processing is asynchronous: the API only validates and enqueues (pg-boss); the collector's pipeline does the rest.

## 5. Sources

| Phase | Connector | Kind | Status |
|---|---|---|---|
| 2 | France Travail — Offres d'emploi API | Official API | Planned |
| 3 | Greenhouse, Lever, SmartRecruiters, Ashby, then others | Recruiting software (ATS) | Planned |
| 4 | Structured-data crawler (`JobPosting`) | Crawler | Planned |
| 5 | Aggregators and partner feeds (Adzuna…) | API / feed | To evaluate |
| 6 | User-triggered browser extension | Ingestion endpoint | Planned |
| — | Per-site crawlers, AI as a source, automated logged-in bots | Placeholders | Documented only (5.7) |

### 5.1 France Travail (phase 2)

* The official job-offer API (developer account on francetravail.io, OAuth2 "client credentials"; credentials in `FRANCE_TRAVAIL_CLIENT_ID` / `FRANCE_TRAVAIL_CLIENT_SECRET`). Free; covers all of France and includes offers from partner job boards; offers carry ROME codes, structured contract, salary and location data.
* Collection: search by ROME code (IT first) and creation date, incremental (`minCreationDate` from the last cursor). Result windows per query are capped, so queries are split (by département, ROME code, date window) until each slice fits under the cap. **To verify at implementation**: exact paging limits, rate limits, and the terms of reuse (attribution, display, storage).
* `isStillOpen`: offers missing from the source are re-checked by id before being closed.

### 5.2 Recruiting software / ATS (phase 3)

Many companies publish their openings through their ATS, with public endpoints intended for job boards: structured, clean, legal, and one adapter covers every company using the tool.

* First adapters: **Greenhouse** (`boards-api.greenhouse.io/v1/boards/{company}/jobs`), **Lever** (`api.lever.co/v0/postings/{company}`), **SmartRecruiters** (`api.smartrecruiters.com/v1/companies/{id}/postings`), **Ashby** (`api.ashbyhq.com/posting-api/job-board/{org}`). Then Workable, Teamtailor, Recruitee, Welcome to the Jungle's ATS and others: **endpoints and terms to verify one by one**.
* **Company registry** (`companies` + `company_sources`: company, ATS, slug, last run): which companies use which tool. Built from employer names seen in France Travail offers, lists of tech companies and large employers, the Sirene register (SIREN, address), and the career pages found by the crawler (which often reveal the ATS). This is a sub-project of its own; IT companies first.

### 5.3 Structured-data crawler (phase 4)

* Reads schema.org `JobPosting` (JSON-LD) from company career pages, the same data published for Google for Jobs. Generic: no per-site code.
* Starts from the career-page URLs of the company registry and their sitemaps; follows only offer pages.
* Respects `robots.txt`, crawl delays and a per-domain rate limit; uses the SSRF-safe fetcher of the API (`lib/safe-fetch.ts`, to be moved to a shared package).

### 5.4 Aggregators and partner feeds (phase 5)

* Aggregator APIs (e.g. Adzuna) and XML feeds that job boards provide to aggregators. Each one only if its terms allow storing and displaying the offers, with the required attribution and links back.

### 5.5 User-added offers (already built, O5)

* Private offers added by users. Later they go through the same contract and pipeline (deduplication with collected offers); when a connector collects the same URL, the offer becomes public (O5 rule).

### 5.6 User-triggered browser extension (phase 6)

* A browser extension the user clicks on an offer page they are viewing ("save this offer"), including sites that require being logged in. One page, by the user, in their own session, like pasting the text in O5. It sends a `CollectedOffer` to the ingestion endpoint with the user's session; the offer is private to that user (O5).

### 5.7 Placeholders (documented, not functional)

These connectors exist in `connectors/placeholders/` with the interface implemented and `schedule: null`: they collect nothing. They are kept so the design has a place for them; each needs a decision before being built.

* **Per-site crawlers** (`site-crawler.ts`): code specific to one website, for high-value sites with no API, ATS or structured data. Conditions before building one: the site's terms allow it, `robots.txt` allows it, and the value justifies the maintenance (per-site code breaks when the site changes).
* **AI as a source** (`ai-source.ts`): asking an AI model for offers ("IT jobs in Paris"). Not built because models don't have live offers and invent plausible ones (companies, URLs). If it is built later, the AI only **suggests leads** (companies, career pages, offer URLs), and every lead is verified by fetching the real page and extracting it with a real connector (5.2, 5.3) before anything is stored. Never stored directly.
* **Automated logged-in bots** (`logged-in-bot.ts`): bots browsing sites that require an account (e.g. LinkedIn) and posting to the ingestion endpoint. Not built because these sites' terms forbid automated access, accounts get banned, and the EU database right and GDPR apply. The ingestion contract is ready for it; the user-triggered extension (5.6) covers the legitimate part of the idea.

## 6. Pipeline

Each stage is idempotent and can be re-run on stored raw data.

1. **Store raw**: `raw_offers` (source, external id, payload, received at, content hash). Unchanged payloads (same hash) stop here.
2. **Normalize**: map to `CollectedOffer` (the connector's mapping), HTML → simplified Markdown (DATABASE.md), URL normalization, trim, units.
3. **Validate**: contract schema; personal data removed (emails, phone numbers, recruiter names in descriptions); offers without a usable title or description rejected and counted.
4. **Deduplicate** (section 7).
5. **Enrich**:
   * **Location**: codes and coordinates → `locations` (existing table; Geoapify lookup as in O5, `location-match.ts`).
   * **Occupations**: ROME codes from the source, else classification (dictionary on the title, AI when ambiguous); ESCO occupation through the ROME ↔ ESCO correspondence.
   * **Skills**: ESCO, by dictionary matching on the source's skill labels and the description (as `offer-catalogue.ts` does for O5); AI only when the offer has too few matches. Unmatched labels are logged to improve the catalogue.
   * **Language**: from the source, else detected.
   * **Missing fields** (contract, remote, salary) from the description by the AI, only when absent from the structured data, and only for in-scope offers (IT first) to control cost.
   * **Quality score** (0–100): completeness (salary, location, contract, description length, skills) and freshness. Used to rank search results later and to monitor sources.
6. **Upsert**: create or update the `offers` row and its `offer_sources` row; `offer_skills` / `offer_occupations` rewritten.
7. **Close expired**: an offer is closed (`closed_at`) when all its sources dropped it (missing from incremental syncs and confirmed by `isStillOpen` when available, or past `expiresAt`), or when its URL answers "not found" for several days. Offers are never deleted (user history references them).

## 7. Deduplication

The same job is often published on France Travail, the company's ATS and several job boards. One `offers` row per job, with one `offer_sources` row per source.

1. **Same source and external id** → same offer (update).
2. **Same normalized URL or apply URL** → same offer.
3. **Fingerprint**: normalized company (SIREN when known, else normalized name) + normalized title + département + publication date within ±14 days → probable duplicate; descriptions compared (text similarity) to confirm. Uncertain pairs can be judged by the AI and are logged for review.
4. **Which source wins** for each field: a fixed priority per field (company ATS > France Travail > aggregators for the description; structured salary from whichever has it…). The winning values are written to `offers`; every source's values stay in `offer_sources` / `raw_offers`.

## 8. Database changes

To add with migrations when the collector starts (details settled in each phase):

| Table / change | Purpose |
|---|---|
| `offer_sources` (offer_id, source, external_id, url, apply_url, first_seen_at, last_seen_at, closed_at) | One offer, many sources. Replaces `offers.source` / `offers.external_id` as the source of truth (kept on `offers` for the main source) |
| `raw_offers` (source, external_id, payload JSONB, content_hash, received_at) | Raw data kept for reprocessing |
| `collector_runs` (connector, started_at, finished_at, cursor, counts JSONB, error) | Run history and statistics |
| `collector_tokens` (source, token_hash, limits, created_at, revoked_at) | Auth of the ingestion endpoint |
| `companies` (name, normalized_name, siren, website, …) + `offers.company_id` | Deduplication and company registry (FEATURE C1, brought forward) |
| `company_sources` (company_id, ats, slug, career_url, last_run_at, status) | Which ATS / career page to collect for each company |
| `offers.quality_score` | Quality score (6.5) |
| Occupations with `source = 'rome'` and `'esco'`; `occupation_relationships` (`equivalent`) for the ROME ↔ ESCO correspondence | ROME + ESCO catalogue (section 8.1) |

### 8.1 Catalogue: ROME + ESCO

* **Occupations**: ROME (France Travail's referential, native in our main source) and ESCO, both in `occupations` (`source = 'rome'` / `'esco'`), linked by the official ROME ↔ ESCO correspondence stored in `occupation_relationships` (`equivalent`). Offers are linked to their ROME occupation and to the equivalent ESCO occupation(s), so resumes linked to either match.
* **Skills**: ESCO (French and English names and synonyms), as planned for M2. Skill labels from France Travail are matched to ESCO names; unmatched labels are logged.
* Imported by `npm run collector -- catalogue [--esco <folder>] [--refresh]` (`catalogue/import.ts`), re-runnable when new versions come out:
  * **ROME 4.0**: France Travail's open data, all files in one zip (`https://api.francetravail.fr/api-nomenclatureemploi/v1/open-data/json`, Licence Ouverte 2.0; version 61 of June 2026 when imported). Files are **Windows-1252**; a few values are double-encoded and repaired. Each ROME occupation (1 911) gets its label and all its appellations (14 301) as French names, with masculine / feminine variants ("Développeur / Développeuse informatique" → "Développeur informatique", "Développeuse informatique") so that offer titles match; `parent_id` holds the hierarchy.
  * **ROME ↔ ESCO**: the official table published by Pôle emploi / France Travail on the ESCO portal (EURES mapping tables, `EURESmapping_occs_FR_v1.1.csv`, mapping v1.4 of July 2022, ESCO 1.1 ↔ ROME v3). It maps ROME **appellations** to ESCO occupations (exact / broad / narrow / close match); 99.9 % of its appellations still exist in ROME 4.0 (unknown ones are counted and skipped). Stored per (ROME occupation, ESCO occupation): `equivalent` if any appellation is an exact match, else `related` (2 626 links, 1 025 equivalent).
  * **ESCO** occupations and skills (French and English, preferred and alternative labels): the CSV package from the ESCO portal's download page (version 1.2.1, content "classification", languages fr and en, file type CSV; the link is sent by email, so this step is manual). Unzip the files into one folder (`data/esco/`, ignored by git) and pass `--esco data/esco`; the importer reads every `occupations_xx.csv` and `skills_xx.csv`.
  * **Manual technical skills**: the hand-written list of the development seed (React, Node.js… which ESCO may lack), source `manual`.
  * Downloads are cached in `data/catalogue/` (`--refresh` downloads again). `npm run db:seed` empties every table, catalogue included: run the import again after it.
* Resume matching (M2) also links resumes to ROME occupations through the correspondence.

## 9. Measuring coverage and quality

Measured per source and overall, visible as SQL views first:

| Metric | Definition |
|---|---|
| **Coverage** (evaluation slice) | Each month, a sample of IT offers in Île-de-France found by hand on the big job boards (Indeed, Welcome to the Jungle, LinkedIn, HelloWork, APEC): share that we have |
| **Volume** | Open offers, new offers per day, per source and per ROME code |
| **Freshness** | Delay between publication and collection; share of open offers verified in the last 7 days |
| **Duplicates** | Share of offers with several sources; duplicates found by hand in samples |
| **Completeness** | Share with salary, location, contract type, ≥ 3 skills, description > 500 characters |
| **Dead links** | Share of open offers whose URL no longer works |
| **Cost** | AI calls and Geoapify credits per 1 000 offers |

The coverage sample tells us which sources to add next.

## 10. Legal and compliance checklist (per source, before enabling it)

* Terms of use allow automated collection, storage and display; attribution and links back as required.
* `robots.txt` and crawl delays respected (crawlers).
* No personal data collected (GDPR); recruiter contacts removed.
* No substantial extraction of a protected database without permission (EU database right).
* Honest User-Agent with a contact address; per-source rate limits.
* Each source's status recorded in this document.

## 11. Phases

| Phase | Content | Done when |
|---|---|---|
| **1. Foundations** | `apps/job_collector` skeleton, pg-boss, connector interface, ingestion contract (shared), pipeline stages, `offer_sources` / `raw_offers` / `collector_runs` / `companies`, **ROME + ESCO import**, placeholders (5.7), metrics views | A fake connector's offers go through the whole pipeline with deduplication and enrichment; catalogue imported |
| **2. France Travail** | Connector, IT ROME codes, all of France, incremental sync, closing expired offers | IT offers of all France collected daily; first metrics on the evaluation slice |
| **3. ATS** | Greenhouse, Lever, SmartRecruiters, Ashby adapters; company registry and discovery (IT companies first) | Coverage and duplicates measured against phase 2 |
| **4. Structured-data crawler** | `JobPosting` crawler on registry career pages | Same |
| **5. Aggregators / feeds** | Sources whose terms fit | Same |
| **6. Browser extension** | Ingestion endpoint + extension (separate project) | Offers saved from any page by users |
| Later | Other occupations than IT; placeholders if a decision is taken | |

## 12. Open questions

1. France Travail credentials: the token request answers `invalid_client` (2026-10-13) — check the application on francetravail.io (credentials copied correctly, application activated, API "Offres d'emploi v2" subscribed).
2. France Travail terms of reuse: attribution and display rules to confirm before showing their offers.
3. Which ATS tools are most used by IT companies in France: to measure on the company registry before choosing adapters after the first four.
4. Hosting: the collector runs continuously (worker) — where and how it is deployed is part of production readiness.

## 13. Phase 1 — what was built

* **Workspaces**: `apps/job_collector` (connectors, pipeline, runs, catalogue import, worker, CLI) and `packages/backend` (`@job/backend`: server code shared with the API — database client, catalogue matcher, offer links, locations with Geoapify, HTML → Markdown, job queues).
* **Database** (migrations `collector_foundations`, `offer_source_expiry`): `companies`, `company_sources`, `offer_sources` (with `expires_at`), `raw_offers`, `collector_runs`, `collector_tokens`; `offers.company_id`, `quality_score`, `fingerprint`; `occupations.parent_id`.
* **Ingestion contract**: `packages/shared/src/collector/contract.ts` (`collectedOfferSchema`, JSON Schema with `npm run collector -- contract`).
* **Ingestion endpoint**: `POST /api/collector/ingest`, Bearer token per source (`npm run collector -- token <source> <name>`, shown once, stored hashed), ≤ 100 offers per request (body ≤ 5 MB), 120 requests/minute per token, an offer's `source` must be its token's source, answers `202` with a result per offer; accepted offers go to the `collector-ingest` queue.
* **Queues and schedules**: pg-boss 12 in the `pgboss` schema (not managed by Prisma, no drift). Queues `collector-run`, `collector-ingest`, `collector-maintenance` (daily 03:30). The API's connection only sends jobs.
* **Pipeline** (`pipeline/process.ts`), every stage tested: raw stored (unchanged content = only "seen"), contract validated, HTML → Markdown, emails and phone numbers removed, company (SIREN, else normalized name, legal forms removed), location (city via the table then Geoapify, else département from the code or the postcode, else country), fingerprint, deduplication (same source → same URL or apply URL → fingerprint + publication within 14 days + description similarity ≥ 0.5), occupations (ROME codes or ESCO URIs from the source, else the title; completed with their ROME ↔ ESCO links), skills (source labels and dictionary matching), language (source, else stop-word detection), quality score, upsert with per-source priority (ATS 5 > API 4 > crawler 3 > aggregator 2 > ingest 1 > user-added/placeholder 0; the salary is taken as one group), closing when all sources dropped an offer and reopening when one publishes it again, daily expiry.
* **Catalogue matcher** (`@job/backend`, `catalogue/matcher.ts`): offers' skills and occupations are found by looking up token groups ("node.js", "c#" and ".net" stay whole) in an index of every name; 42 000 names load in under a second, a title is matched in a few milliseconds. Very ambiguous words (go, c, r, swift…) are only matched when a source gives them as a skill label. Also used for user-added offers (O5).
* **Placeholders**: `site-crawler`, `ai-source`, `logged-in-bot` (§5.7), registered, collecting nothing.
* **Commands**: `npm run collector:start` (worker), `npm run collector -- catalogue | run <connector> | maintenance | metrics | token <source> <name> | contract`.

Not in phase 1 (planned with the first real sources): AI for missing fields and uncertain duplicates, removing recruiter names (needs AI), `isStillOpen` checks and full-sync closing (connector-specific), the company registry's discovery.
