# Architecture

## Overview

Job Platform is a web application built around a React frontend, an Express backend, and a PostgreSQL database.

The project is organized as a monorepo with separate applications for the frontend, backend API, and job collector, plus one shared package for code that both the frontend and the backend need.

## Applications

### Test client

The `test-client` application is a minimal React + Vite SPA used to try the API by hand while the backend is being built. It is a development tool, not the product:

* One plain page per API feature (search, offer detail, saved offers, login…), showing the API responses with minimal formatting
* No design work, no i18n, no state management library, no component library
* It may be replaced or deleted once `web` exists; nothing else depends on it

Layout: `src/api.ts` (fetch wrapper that feeds the request log panel), `src/App.tsx` (tabs, current user, request log), one file per page in `src/pages/`. Navigation is plain React state (no router). Vite proxies `/api` to the API, so the session cookie works without CORS.

### Web *(later)*

The `web` application is the complete React SPA, built after the API. The responsibilities below, i18n (FEATURE L1) and the UI details in `FEATURE.md` apply to it, not to the test client.

Responsibilities:

* User interface
* Navigation
* Displaying jobs and user data
* Sending requests to the API
* Managing frontend state

### API

The `api` application is the Express backend.

Layout (`apps/api/src`): `app.ts` builds the Express app (used by the server and the tests), `server.ts` starts it, one folder per domain (`offers/`, `auth/`…) holding its routes, its logic and its tests, and `lib/` for shared helpers (Prisma client, errors).

Conventions:

* Routes are under `/api` (the frontends reach them through the Vite proxy in development).
* Request parameters are validated with the Zod schemas from `packages/shared`.
* Errors are returned as `{ "error": { "code": "…", "message": "…" } }` with a stable `code`; validation errors also list `issues`.
* `req.user` is set when the request carries a valid `session` cookie. Route guards in `auth/session.ts`: `requireUser` (creates a guest on the first write, FEATURE G1), `requireSession` (any user, no guest creation), `requireRegistered` (accounts only).
* Limits and rate limits live in `apps/api/src/config.ts`. Rate limits are kept in memory (one API process); they move to the database or Redis if the API runs on several processes.
* State-changing requests carrying an `Origin` header must come from `WEB_ORIGINS` (CSRF check, with the `SameSite=Lax` cookie).
* SQL that Prisma's query builder cannot express (location matching, trigram search) is written with `Prisma.sql` tagged templates, never by concatenating strings.
* Tests use Node's test runner (`node --test`) and run against the seeded development database, one file at a time. Helpers in `apps/api/src/test/helpers.ts` start a server, keep cookies like a browser and delete the users a test file created.
* TypeScript runs directly through `tsx`; there is no build step yet.
* Files go through `lib/storage.ts` (local disk under `STORAGE_LOCAL_DIR`, default `./storage`; S3 later behind the same functions).
* Resume templates are TypeScript functions returning HTML (`apps/api/src/templates/`, one file per `renderer_key`). Every resume value is escaped; the HTML preview is served with a CSP that blocks scripts. PDFs are printed from that HTML by one shared headless Chromium (`playwright-core`), with network access blocked.
* Images are processed with `sharp` (EXIF orientation applied, metadata removed, resized, saved as WebP). The template gets the photo as a data URL, so rendering needs no network.
* Background cleanup (`jobs/cleanup.ts`) runs inside the API every `CLEANUP_INTERVAL_HOURS` (default 24, `0` disables it) and can be run once with `npm run jobs:cleanup` (e.g. from cron). It deletes database rows first, then files.
* **AI** (`apps/api/src/ai/`): features call `runAiJson` with instructions, content, and a Zod schema; it asks the provider for JSON, validates the answer with the schema, and retries once if it is invalid. Providers implement one interface (`provider.ts`): `gemini.ts` now, others later; chosen with `AI_PROVIDER` / `AI_MODEL`. The provider only gets the shape of the schema (Gemini rejects complex constraints); the full Zod validation happens afterwards. Temporary provider errors (503, per-minute 429) are retried within the 60 s timeout. AI failures are HTTP errors (`ai_unavailable` 503, `ai_timeout` 504, `ai_failed` / `ai_invalid_output` 502); nothing is saved and no quota is used. Tests use `FakeProvider` and never call a real AI. Prompts tell the model that user content is data, never instructions.
* Resume parsing: text extracted from the PDF (`unpdf`, also counts pages) or DOCX (`mammoth`), then parsed by the AI (`resumes/resume-parser.ts`). The AI fills the content without item ids or `schemaVersion`; the API adds them.
* Offer extraction (`offers/offer-extractor.ts`): the page is fetched by `lib/safe-fetch.ts`, reduced to simplified Markdown plus its schema.org `JobPosting` data (`offers/page-text.ts`), and read by the AI; pasted text is sent as is and kept as the description. The extracted place is matched to `locations` by name (`locations/location-match.ts`).
* **Fetching user-supplied URLs** goes only through `lib/safe-fetch.ts`: http(s) on ports 80/443, the host must resolve to public addresses only (checked in the DNS lookup of the connection itself, so DNS rebinding is impossible), every redirect re-checked, 10 s / 2 MB limits, HTML or text only. Never use `fetch` directly on a URL coming from a user.
* **Resume generation** (M1/M4): `generated-resumes/resume-modifier.ts` asks the AI for the allowed sections only (the output schema is built from the modifier settings) with the strength rules in the prompt; `generated-resumes/change-set.ts` (pure functions, unit-tested) turns the proposal into the change set, drops what the strength or permissions don't allow, applies changes (replace → remove → add → reorder) and applies accept/reject decisions to the current content so manual edits are kept.
* Offer skills/occupations of user-added offers are found by dictionary matching of catalogue names as whole words (`offers/offer-catalogue.ts`).

Responsibilities:

* REST API
* Authentication and authorization
* Business logic
* Data validation
* Communication with PostgreSQL through Prisma

### Job Collector

The `job_collector` application is responsible for collecting job offers.

It runs independently from the web application and communicates directly with the database.

Its implementation will evolve as the project develops. It is postponed until the API can search offers; until then the development seed (`prisma/seed/`) fills the database.

## Shared package

The `packages/shared` package contains pure TypeScript code used by more than one application. It has no dependency on React, Express, Prisma or the database.

Contents:

* Validation schemas: ResumeContent, modifier_config, change set, search parameters (see `DATABASE.md`)
* The match % formula (`FEATURE.md` O4): the web app uses it to display scores, and the API uses it to store the score snapshot on generated resumes
* Request and response types of the API (e.g. `OfferSearchResponse`)
* The catalogue name normalization (`normalizeCatalogueName`) and the offer URL normalization (`normalizeOfferUrl`), used by the API, the seed and later the collector
* Shared types and constants (enum values, limits that the UI must display)

Rules:

* Only put code here when at least two applications need it.
* No I/O (no HTTP, no database, no file system): only functions and types.
* A business rule that lives here must not be re-implemented in an application.

## Database

PostgreSQL is the main database.

Prisma is used as the database access layer.

The Prisma schema is located in:

```text
prisma/schema.prisma
```

Database changes are managed using Prisma migrations.

Development data comes from `prisma/seed/` (`npm run db:seed`). The seed empties the database first, so it is for development and tests only.

## Main domains

The application is divided into several main domains:

* Jobs
* Users
* Resumes

Additional domains may be added as the application grows.

## Communication

The frontend communicates with the backend through HTTP requests to the Express REST API.

```text
React ──────────┐
  ↓             │ imports
Express API ────┤
  ↓             ▼
Prisma      packages/shared
  ↓
PostgreSQL
```

The job collector is independent:

```text
Job Collector
      ↓
PostgreSQL
```

## Principles

* Keep the architecture simple.
* Keep frontend, backend, and database responsibilities separated.
* Keep business logic out of the React components.
* Keep database access through Prisma.
* Avoid unnecessary abstractions.
* Prefer simple solutions that can evolve later.
* Do not implement future requirements before they are needed.
* Write shared business rules once, in `packages/shared`.