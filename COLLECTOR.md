# Job collector

Plan and reference for `apps/job_collector`: the process that finds job offers and stores them in the shared database. Decisions are logged in `claude/DECISIONS.md` (Updates 20–21).

**Status: phases 1 (foundations, §13) and 2 (ATS adapters + discovery, §14) done.** France Travail's offer API is closed to new users (§5.1); phase 3 (structured-data crawler) is next.

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
│   └── placeholders/          # site-crawler.ts, ai-source.ts, logged-in-bot.ts (5.8)
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
| 2 | Greenhouse, Ashby, SmartRecruiters, Lever, then others + company discovery | Recruiting software (ATS) | Next |
| 3 | Structured-data crawler (`JobPosting`) | Crawler | Planned |
| 4 | Choisir le service public (weekly open data) | Open data file | Planned |
| 4 | La bonne alternance (apprenticeship offers) | Public API | To evaluate (terms: non-profit use only) |
| 5 | Aggregators and partner feeds (Adzuna, Jooble, Careerjet…) | API / feed | To evaluate (terms, descriptions often truncated) |
| — | France Travail — Offres d'emploi API | Official API | **Blocked**: access closed since early 2026, request needed (§5.1) |
| 6 | User-triggered browser extension | Ingestion endpoint | Planned |
| — | Per-site crawlers, AI as a source, automated logged-in bots | Placeholders | Documented only (5.8) |

**Why several sources**: no single source covers the market, and any can close. In early 2026 France Travail withdrew its open offer API after massive reuse by AI services; it was meant to be our main source.

### 5.1 France Travail (blocked)

* **Status (2026-10-13)**: around January 2026 France Travail stopped exposing the Offres d'emploi API on its old domain while reviewing its reuse terms, after massive automated use by AI services that ignored the licence; organizations must now ask for access through the contact form on francetravail.io. Our credentials answer `invalid_client`. Next step: an access request explaining the use (job search service, offers displayed with attribution and a link to the original). The connector is built only once access is granted.

* The official job-offer API (developer account on francetravail.io, OAuth2 "client credentials"; credentials in `FRANCE_TRAVAIL_CLIENT_ID` / `FRANCE_TRAVAIL_CLIENT_SECRET`). Free; covers all of France and includes offers from partner job boards; offers carry ROME codes, structured contract, salary and location data.
* Collection: search by ROME code (IT first) and creation date, incremental (`minCreationDate` from the last cursor). Result windows per query are capped, so queries are split (by département, ROME code, date window) until each slice fits under the cap. **To verify at implementation**: exact paging limits, rate limits, and the terms of reuse (attribution, display, storage).
* `isStillOpen`: offers missing from the source are re-checked by id before being closed.

### 5.2 Recruiting software / ATS (phase 2)

Many companies publish their openings through their ATS, with public endpoints intended for job boards: structured, clean, legal, and one adapter covers every company using the tool.

* First adapters: **Greenhouse** (`boards-api.greenhouse.io/v1/boards/{company}/jobs?content=true`), **Ashby** (`api.ashbyhq.com/posting-api/job-board/{org}?includeCompensation=true`), **SmartRecruiters** (`api.smartrecruiters.com/v1/companies/{id}/postings`, description in a second call per offer), **Lever** (`api.lever.co/v0/postings/{company}?mode=json`). Checked on 2026-10-13: Greenhouse (Datadog: 435 offers, 48 in Paris, full HTML descriptions), Ashby (Alan: 118 offers, 53 in Paris, full descriptions), SmartRecruiters (Ubisoft: 100+ offers, 34 in Paris) answer without authentication; Lever answers but the tested company had moved away — boards must be re-checked regularly. Then Workable, Teamtailor, Recruitee, Welcome to the Jungle's ATS and others: **endpoints and terms to verify one by one**.
* **Company registry** (`companies` + `company_sources`: company, ATS, slug, last run): which companies use which tool. A sub-project of its own; IT companies first. Discovery sources:
  * **Common Crawl's URL index** (public archive of the web): every crawled URL of `boards.greenhouse.io/*`, `jobs.ashbyhq.com/*`, `jobs.lever.co/*`, `jobs.smartrecruiters.com/*`, `*.recruitee.com`, `*.teamtailor.com`… gives company slugs. The public query API is often overloaded (it answered 504 on 2026-10-13); use the columnar index (Parquet files, queryable in bulk) instead.
  * **Web Data Commons** (University of Mannheim): schema.org `JobPosting` data extracted from Common Crawl every year (about 50 000 websites in 2022), giving career pages that publish structured offers, and often the ATS behind them.
  * Lists of tech companies and large employers; the Sirene register (SIREN, address) to identify companies.
  * Each discovered board is checked (does it answer, does it have offers in France?) before being followed; boards with no French offer are re-checked monthly only.

### 5.3 Structured-data crawler (phase 3)

* Reads schema.org `JobPosting` (JSON-LD) from company career pages, the same data published for Google for Jobs. Generic: no per-site code.
* Starts from the career-page URLs of the company registry and their sitemaps; follows only offer pages.
* Respects `robots.txt`, crawl delays and a per-domain rate limit; uses the shared SSRF-safe fetcher (`@job/backend` `net/safe-fetch.ts`).
* Built in phase 3: see §15.

### 5.4 Public-sector and apprenticeship sources (phase 4)

* **Choisir le service public**: the public-sector job platform (about 350 000 offers a year, all three branches of the civil service) publishes its offers as open data on data.gouv.fr, refreshed weekly (CSV). Users report that the file has much less detail than the website; to measure before relying on it.
* **La bonne alternance** (apprenticeship offers, searchable by ROME code and location, API on api.apprentissage.beta.gouv.fr): its terms reserve the API for non-profit use and cap results per source; to clarify before use.

### 5.5 Aggregators and partner feeds (phase 5)

* Aggregator APIs (Adzuna has a self-service key and covers France; Jooble, Careerjet, Talent.com need publisher approval) and XML feeds that job boards provide to aggregators. Each one only if its terms allow storing and displaying the offers, with the required attribution and links back. Known limits: descriptions are often excerpts, links go through the aggregator, salaries may be estimated (Adzuna flags them).

### 5.6 User-added offers (already built, O5)

* Private offers added by users. Later they go through the same contract and pipeline (deduplication with collected offers); when a connector collects the same URL, the offer becomes public (O5 rule).

### 5.7 User-triggered browser extension (phase 6)

* A browser extension the user clicks on an offer page they are viewing ("save this offer"), including sites that require being logged in. One page, by the user, in their own session, like pasting the text in O5. It sends a `CollectedOffer` to the ingestion endpoint with the user's session; the offer is private to that user (O5).

### 5.8 Placeholders (documented, not functional)

These connectors exist in `connectors/placeholders/` with the interface implemented and `schedule: null`: they collect nothing. They are kept so the design has a place for them; each needs a decision before being built.

* **Per-site crawlers** (`site-crawler.ts`): code specific to one website, for high-value sites with no API, ATS or structured data. Conditions before building one: the site's terms allow it, `robots.txt` allows it, and the value justifies the maintenance (per-site code breaks when the site changes).
* **AI as a source** (`ai-source.ts`): asking an AI model for offers ("IT jobs in Paris"). Not built because models don't have live offers and invent plausible ones (companies, URLs). If it is built later, the AI only **suggests leads** (companies, career pages, offer URLs), and every lead is verified by fetching the real page and extracting it with a real connector (5.2, 5.3) before anything is stored. Never stored directly.
* **Automated logged-in bots** (`logged-in-bot.ts`): bots browsing sites that require an account (e.g. LinkedIn) and posting to the ingestion endpoint. Not built because these sites' terms forbid automated access, accounts get banned, and the EU database right and GDPR apply. The ingestion contract is ready for it; the user-triggered extension (5.7) covers the legitimate part of the idea.

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
3. **Fingerprint**: normalized company (SIREN when known, else normalized name) + normalized title + département + publication date within ±14 days → probable duplicate (no département known → no fingerprint: one title can be a hundred offers, one per town); descriptions compared (text similarity) to confirm. Uncertain pairs can be judged by the AI and are logged for review.
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
  * **Manual technical skills**: the hand-written list of the development seed, source `manual`, **only for skills ESCO doesn't have** (a manual skill is skipped when one of its names is an ESCO name). ESCO 1.2.1 lacks most current technology names: React, Node.js, Docker, Kubernetes, Vue.js, GraphQL, AWS, Terraform, Power BI… (it has JavaScript, TypeScript, PostgreSQL, Python, SQL, Git, Angular, Java, PHP, Scrum, DevOps). On 2026-10-13: 37 manual skills added, 28 already in ESCO. **The IT technology list must keep growing** (phase 2: from the skill labels France Travail gives and the unmatched terms the pipeline logs).
  * Imported on 2026-10-13: ESCO 1.2.1 — 3 039 occupations (50 079 names) and 13 939 skills (120 903 names) in French and English; 3 ESCO occupations of the 2022 correspondence no longer exist in 1.2.1 (kept with their French name).
  * Downloads are cached in `data/catalogue/` (`--refresh` downloads again). `npm run db:seed` empties every table, catalogue included: run the import again after it. Tests (`npm test`) use their own database, so they leave the catalogue and collected data alone.
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
| **1. Foundations** | `apps/job_collector` skeleton, pg-boss, connector interface, ingestion contract (shared), pipeline stages, `offer_sources` / `raw_offers` / `collector_runs` / `companies`, **ROME + ESCO import**, placeholders (5.8), metrics views | A fake connector's offers go through the whole pipeline with deduplication and enrichment; catalogue imported |
| **2. ATS + discovery** | Greenhouse, Ashby, SmartRecruiters, Lever adapters (full sync per board, closing offers that disappear); company registry fed by Common Crawl / Web Data Commons discovery; IT companies with offers in France first | IT offers of the discovered companies collected daily; first metrics on the evaluation slice |
| **3. Structured-data crawler** | `JobPosting` crawler on registry career pages | Coverage and duplicates measured against phase 2 |
| **4. Public sector / apprenticeship** | Choisir le service public (weekly file); La bonne alternance if its terms allow | Same |
| **5. Aggregators / feeds** | Sources whose terms fit; France Travail if access is granted | Same |
| **6. Browser extension** | Ingestion endpoint + extension (separate project) | Offers saved from any page by users |
| Later | Other occupations than IT; placeholders if a decision is taken | |

## 12. Open questions

1. France Travail: the offer API is closed to new users since early 2026; send an access request through francetravail.io (use: job search service with attribution and links to the original offers).
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
* **Catalogue matcher** (`@job/backend`, `catalogue/matcher.ts`): offers' skills and occupations are found by looking up token groups ("node.js", "c#" and ".net" stay whole; hyphens separate words, so ROME's "full-stack" matches "Full Stack") in an index of every name; the full catalogue (~210 000 names) loads in under 2 s, a text is matched in a few milliseconds. Very ambiguous words (go, c, r, swift…) are only matched when a source gives them as a skill label; short all-capital names (ESCO acronyms such as "AVEC", "PAP", "MDM") only match when written in capitals ("avec" is a French word). Known noise: a few single-word ESCO skills are ordinary words ("politique"); to handle in phase 2 (frequency check or AI). Also used for user-added offers (O5).
* **Placeholders**: `site-crawler`, `ai-source`, `logged-in-bot` (§5.8), registered, collecting nothing.
* **Commands**: `npm run collector:start` (worker), `npm run collector -- catalogue | run <connector> | maintenance | metrics | token <source> <name> | contract`.

Not in phase 1 (planned with the first real sources): AI for missing fields and uncertain duplicates, removing recruiter names (needs AI), `isStillOpen` checks and full-sync closing (connector-specific), the company registry's discovery.

## 14. Phase 2 — what was built

* **Adapters** (`apps/job_collector/src/ats/adapters/`): Greenhouse, Ashby, Lever and Lever EU (`api.eu.lever.co`, a separate instance), SmartRecruiters. Each one `check`s a board (exists? offers? offers in France?) and `collect`s **its offers located in France only** (country field when the tool gives one, else the location text: France, Île-de-France, French cities), mapped to the ingestion contract. Contract and remote types only from explicit signals (CDI/CDD/stage/alternance/freelance words, the tool's own fields); "full time" alone leaves the contract empty. Salaries when published (Ashby, Lever). Greenhouse descriptions are entity-encoded HTML and are decoded. The city is a known French city in the location text, else the text's first part when it reads like a place name ("Sanary-sur-mer"), resolved by the location table then Geoapify (names compared without accents, case, hyphens). SmartRecruiters needs one detail request per offer: known offers whose release date didn't change are only marked as still listed, and each is fetched again about once a week (`ats.detailRefreshDays`, spread by offer id).
* **One connector per tool** (`ats/connector.ts`), every 6 hours, collects the `active` boards. Each board is a **full sync**: after a successful read, the board's offers that disappeared are closed; a failing board closes nothing (error kept in `company_sources.last_error`); a board that answers 404 becomes `invalid`.
* **Discovery** (`discovery/common-crawl.ts`, `npm run collector -- discover [--ats …] [--pages N]`, monthly in the worker): Common Crawl's URL index, read page by page with pauses and retries; candidates saved after each URL prefix (a busy index answering 502 doesn't lose what was found). Board ids that only differ by letter case ("AbbVie" / "abbvie") are one board.
* **Board checks** (`discovery/check-boards.ts`, `npm run collector -- boards check [--ats X] [--limit N]`, nightly batch of 500): statuses `candidate` → `active` (offers in France; its company is created) / `no-france` / `empty` / `invalid` / `duplicate`; re-checked after 7 days (active), 30 (no-france, empty), 90 (invalid). Sandbox accounts (slug ending in "sandbox", or "Sandbox" as a word in the company name) hold fake offers and are `paused`. `boards add <ats> <slug>` adds a board by hand, `boards list` counts them. `boards export [file]` saves the registry (boards, statuses, check dates, companies; default `data/boards-<date>.json.gz`) and `boards import <file>` merges it into another database (missing boards added; for a board on both sides the more recent check wins): this is what carries discovery results to production or across a development reset — offers come back with the first collection run.
* **Runs** interrupted by a stopped process are closed as failed by the next run of the connector.

**First real run (2026-10-13)**, discovery limited to 2 index pages per tool: 2 620 candidate boards (Greenhouse 1 060, SmartRecruiters 857, Ashby 612, Lever EU 64, Lever 27). On a sample of 187 checked boards, 33 had offers in France — SmartRecruiters 16/40, Lever EU 7/40, Lever 6/27, Greenhouse 2/40, Ashby 2/40 (Common Crawl is worldwide; Greenhouse also has many boards that moved away). Those 33 boards announced 2 343 offers in France, mostly two SmartRecruiters boards (Accor 935, ALTEN 711). Collection: about 0.5 s per offer with SmartRecruiters (detail request + pipeline).

**Full run (2026-10-14/15)**: discovery over all index pages of four crawls (CC-MAIN-2026-25 to 2026-39) → 12 953 boards: 688 active (offers in France), 8 575 no-france, 2 394 invalid (mostly companies that left the tool since an older crawl), 1 200 empty, 88 duplicate, 3 paused (sandbox). Collection → **32 322 open offers** (SmartRecruiters 28 211, Greenhouse 2 313, Ashby 1 665, Lever 79, Lever EU 73); one retail group (Groupement Mousquetaires) alone has 9 705. City-level location 95 %, contract type 71 %, salary 0.9 %, ≥ 3 skills 64 %, average quality 69. Offers classified IT (ROME M18 except M1808/M1809): 1 913 (5.9 %), led by ESN/consulting firms (Sopra Steria 187, ALTEN 162, Inetum 109, Devoteam 105, Talan 89); Paris 515, Lyon 131, Nantes 85. Fixes found by this run: wrong merges (no fingerprint without département; never between two records of one source), small towns falling back to the country, sandbox boards; about 3 800 affected offers were deleted and collected again. The first full SmartRecruiters collection took 3 h 15; with known offers skipped, a run takes 45–55 min on a weekly-refresh day and less otherwise.

**IT occupations from titles (2026-10-15)**: dictionary matching missed short and English IT titles ("Développeur Java / AWS Senior", "Staff Data Engineer") and its IT matches were mostly wrong: generic ROME/ESCO names ("Chef de projet", "Spécialiste support", "project manager") put construction, mechanical or accounting jobs in M18. IT occupations from titles now come from **IT title rules** (`pipeline/title-rules.ts`: about 25 patterns on the normalized title, French and English, each giving a ROME M18 code, with look-alikes excluded — business/community developer, ingénieur de production, systems engineer, QA alone, programmeur CN…); the dictionary still gives every other occupation, and its M18 matches are kept only when a rule confirms them. Codes given by a source are kept as they are. The IT scope also excludes the weather and climate codes (M1888, M1890, M1891, M1893). `npm run collector -- reenrich` recomputes stored offers' occupations (no network, ~1.5 min for 33 000 offers). Result: **2 897 IT offers (9 %)** instead of 1 913 of which ~700 were false positives; precision on a random sample of 50 ≈ 94 % (misses: "Business analyst produits frais", "Engineering Manager - Sport Process", an EV-charger network technician, one event page published as an offer). Top IT employers: Sopra Steria 494, Devoteam 199, Inetum 188, ALTEN 182, Talan 156, Everience 134; Paris 914, Lyon 161, Levallois-Perret 143, Nantes 142. Still 38 % of all offers get no occupation (non-IT titles, outside the current evaluation slice).

**Observations for the next steps**
* Most offers of followed companies are not IT (e.g. hotel jobs at Accor): collecting every French offer is consistent with the long-term goal, but the IT evaluation slice needs a filter by occupation (ROME M18) in the metrics, and discovery could favour IT companies first.
* Full discovery (all index pages) should give thousands of boards per tool; at ~10–40 % with offers in France, a few hundred French boards per tool.
* Tests must never touch real boards: the ATS tests are scoped to their own `test-` boards and run records (an earlier version marked 402 real boards invalid — repaired). Since 2026-10-14 tests also run against their own database (`npm test`, `job_test`).

## 15. Phase 3 — what was built

* **Shared safe fetcher** (`packages/backend/src/net/safe-fetch.ts`): moved from the API (public addresses only, checked redirects, limits on time, size and content type; unknown hosts reported as such). The API's offer import keeps a thin wrapper with its HTTP errors.
* **Career-site crawler** (`apps/job_collector/src/crawler/`), as one more kind of board in the company registry (`company_sources.ats = "careersite"`, slug = the start address without `https://`, e.g. `careers.thalesgroup.com`): same checks, statuses, full sync, closing, export/import as the ATS boards; connector kind `crawler` (priority 3), daily at 05:00.
  * **Politeness** (`fetcher.ts`, `robots.ts`): robots.txt per RFC 9309 (our group `MonPosteBot`, else `*`; longest rule wins; `*` and `$`; missing = allowed, server error = nothing allowed, unreachable = site failing; `crawler.respectRobotsTxt` / `CRAWLER_RESPECT_ROBOTS_TXT=false` ignores its Allow/Disallow rules — it is still read for sitemaps and crawl-delay), one request at a time per host, at least 2 s apart or the site's `Crawl-delay` (capped at 30 s). User agent `MonPosteBot/0.1 (+<CRAWLER_CONTACT_URL>; … contact: <CRAWLER_CONTACT_EMAIL>)`, the same contact on every collector request (job board APIs too); in production `https://monposte.com/bot.html` (`apps/web/public/bot.html`) and `bot@monposte.com`, required at startup.
  * **Offer pages** (`discover-pages.ts`): from the sitemaps (robots.txt `Sitemap:` lines, else `/sitemap.xml`; index files followed, job sitemaps first; limits 20 files / 50 000 URLs), else from the start page's links (listing pages followed, 20 at most). An address is an offer page when a job word (jobs, offres, emploi, carrieres, postes…) is followed by another path segment; language prefixes (`/fr/`, `/en/`) are merged, French kept. Pages robots.txt forbids are left out. The JobPosting markup on the page confirms it.
  * **JobPosting** (`job-posting.ts`): found in arrays and `@graph`; mapped to the contract (title, description — entity-encoded HTML decoded —, `datePosted`, `validThrough` → expiry, `employmentType` INTERN/CONTRACTOR/TEMPORARY only, organization, address and coordinates, `TELECOMMUTE` + France requirement → remote, `baseSalary`). Only offers located in France are kept.
  * **Incremental**: the sitemap's `lastmod` is stored with the raw record; a known offer whose date didn't change is only marked as still listed (fetched again about weekly, spread by id), and pages without a French JobPosting are remembered by the worker. At most 1 000 new or changed offer pages per site and run (~35 min at 2 s): a big site fills over a few daily runs.
  * `npm run collector -- boards add careersite <address>` adds a site by hand (checked right away: a sample of 3 offer pages estimates its French offers). Discovery finds **Teamtailor** sites (`*.teamtailor.com`, Common Crawl domain query); other sites are added by hand until a wider source (Web Data Commons) is used.
* **Workable** (`apply.workable.com/api/v1/widget/accounts/{account}?details=true`) and **Recruitee** (`{company}.recruitee.com/api/offers/`) adapters: public, no key, full descriptions (Recruitee: salary, contract code, requirements). Discovered from Common Crawl (`apply.workable.com/` prefix; `*.recruitee.com` domain).

**Checked live (2026-10-15)**: Teamtailor's own site (15 offers, JSON-LD complete, none in France — correctly skipped); Thales (`careers.thalesgroup.com`, a Phenom site: 7 152 offer pages in its sitemaps, about two thirds in France; JSON-LD with city, postcode, département; the `jobs.thalesgroup.com` address redirects there — sites are compared by registered domain); Hugging Face on Workable (6 offers, 3 in France). Common Crawl's index was unavailable for several hours (504 on every query) — discovery tolerates it, and boards can always be added by hand.

**First results (2026-10-15)**:
* **Workable**: 747 accounts discovered (index stopped part-way) → 31 with offers in France → 79 offers (89 received).
* **Recruitee**: 326 companies discovered from one older crawl (the domain query timed out on the others) → 33 active → 238 offers (251 received, 11 rejected); the most complete source: contract type 98 %, salary 32 %, quality 82.
* **Career sites**: 40 Teamtailor sites discovered → 5 active → 20 offers (small French companies: Biscuit International, Epsor, CybelAngel…); Thales added by hand: 1 000 pages read in the first run (40 min) → 584 French offers, 19 % IT (111); the rest of its ~7 000 pages follows over the next daily runs.
* **Overlap with phase 2: none** — every phase 3 offer is new (no merge with an ATS offer), which is the expected value of new sources. Phase 3's IT share is low except for Thales; the IT companies already known come through phase 2.
* **Discovery limits**: Common Crawl's public index answers 504 to most whole-domain queries (`*.recruitee.com`, `*.teamtailor.com`) and was down for hours; results above are partial. Next: its columnar (Parquet) index, which is queried in bulk instead of through the overloaded API.

## 16. Skill matching in offer texts (2026-10-16)

Measured on 4 000 collected offers, most wrong skills came from everyday words: French words that are also skill names ("paris" = betting, "politique" = politics, "vue" = Vue.js, "transformer"), English words matched in French offers through the English fallback ("plan", "transport", "design", "lead"), and boilerplate ("notre processus de recrutement" → Recruitment, in 19 % of offers). Duplicates also counted twice in the match %: the development seed's hand-made skills and the same ESCO concepts ("Python" and "Python (computer programming)").

Rules now (`packages/backend/src/catalogue/matcher.ts`), for skills in free text:
* names in another language than the offer's only when they look technical (a capital letter, a digit or a symbol: "Python", "AWS", "Node.js", "C#");
* ambiguous single words never (paris, politique, plan, vue, lead, source, transport, transformer, lecture, passerelles, physique, communiquer, plus the earlier go, r, swift…);
* a few generic words only in the title (recrutement / recruitment, communication, informatique);
* the same skill in two catalogues has one id (a hand-made skill and any ESCO entry sharing one of its names; ESCO entries with the same main name — alternative names alone never join two entries), for offers and resumes alike (`canonicalIds`);
* labels given as such by a source are always looked up.

`npm run collector -- reenrich` now recomputes stored offers' skills, occupations and quality score, and maps resumes' skills to the merged ids.


## 17. Plan: more sources, and bots (2026-10-16)

### 17.1 More sources, by value for effort

Each source is judged on new offers per week that no other source has (duplicates add
nothing), completeness (`collector metrics`), cost to build and keep, and terms (§10).

| Order | Source | Why | Effort |
|---|---|---|---|
| 1 | **More boards for the existing tools** | Same code, more companies: Common Crawl's columnar index (bulk, not the overloaded API), Sirene's large employers, career sites found from company websites (crawler seeds) | Low |
| 2 | **More ATS adapters**, most used in France first: Teamtailor, Welcome to the Jungle (Welcome Kit), Personio (public XML feed), DigitalRecruiters, Flatchr, Talentsoft/Cegid, Workday (large employers), BambooHR, Breezy | One adapter covers every company on the tool. Measure first which tools the registry's career sites use (open question 3); endpoints and terms to verify one by one | Low–medium each |
| 3 | **Public sources**: Choisir le service public (weekly open data), La bonne alternance (terms), **France Travail access request** (send it: §5.1) | Large volumes, official, structured | Low–medium |
| 4 | **Aggregators and feeds**: Adzuna (self-service key), then Jooble / Careerjet / partner XML feeds | Wide coverage; descriptions often excerpts, attribution required | Medium |
| 5 | **Bots** (§17.2) for valuable sites with no API, ATS or `JobPosting` data, whose terms allow it | Fills the gaps the above leave | Medium per site, plus upkeep |

### 17.2 Bots: thin bots, central extraction

**Decision proposed: bots send what they saw (the offer page, raw), with the few facts only
they know; the collector turns it into an offer.** The strict endpoint (`CollectedOffer`,
§4) stays for sources that already produce clean data (partners, the browser extension).

| | Strict format (AI in each bot) | Raw page (extraction in the collector) |
|---|---|---|
| Fixing an extraction mistake | In every bot, and past offers stay wrong | Once; stored raw pages are processed again (like `reenrich`) |
| AI cost and keys | Spread over bots, hard to cap | One place: cache by content hash (an unchanged page costs nothing), daily budget |
| Consistency | Each bot interprets fields its own way | Same rules for every source |
| Bot code | Bigger, needs an AI key | Navigation only: list pages, offer pages, ids |

What a bot sends (`POST /api/collector/pages`, per-source token as today):
`{ source, externalId, url, title?, html | text, publishedAt?, fetchedAt }`, at most
~300 KB per page (scripts and styles stripped by the bot). The bot owns what only it can
know reliably: **which offers exist** (ids and URLs) and **the page content**.

The collector then: stores the page in `raw_offers` → reads `JobPosting` JSON-LD if present
(the crawler's code) → otherwise extracts with AI (Gemini; same prompt and validation as user
offers, O5), only for pages whose content hash changed → a `CollectedOffer` → the usual
pipeline (dedup, enrichment, closing).

### 17.3 Offers that expire

Bots rarely see an offer "close": it just stops being listed. Four layers, cheapest first:

1. **Complete snapshots** (main rule): after each run, a bot reports the full list of offer
   ids it currently sees for a scope (`POST /api/collector/snapshots`
   `{ source, scope, externalIds, complete: true }`). Ids missing from a complete snapshot are
   closed, like the ATS full sync. Safety: if a snapshot loses more than half the open offers
   at once, nothing is closed and an alert is sent (the bot probably broke, not the site).
2. **Not seen for too long**: `offer_sources.last_seen_at` already exists; daily maintenance
   closes bot offers not seen for N days (per source, default twice its schedule, at least
   7 days). Covers bots that stopped.
3. **Expiry date** when the page gives one (`validThrough`, "date limite"): `expires_at`,
   already handled by maintenance.
4. **Spot checks**: open bot offers older than 30 days are fetched again now and then
   (politely); 404/410 or a redirect to a listing page closes them.

Plus an alert when a source sends nothing for two schedules.

### 17.4 Order of work

1. Measure which ATS tools the registry's companies use; add the top 2–3 adapters.
2. Send the France Travail access request; add Choisir le service public.
3. Pages endpoint + central extraction + snapshots + "not seen" closing (§17.2–17.3), with
   one first bot on a site whose terms allow it, to validate the design.
4. Aggregators whose terms fit.
