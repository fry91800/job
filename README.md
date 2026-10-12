# Job Platform

Web application for finding job offers, managing professional profiles and resumes, and automatically adapting resumes to job offers.

## Status

Early development / MVP.

Current focus:

* Backend API (Express). Done: offer search and detail, location autocomplete, guest sessions and accounts, saved offers, resumes (upload uses a placeholder parser), photos, user-added offers (placeholder extractor), match %, settings and templates, resume generation without AI and PDF download, cleanup jobs (see *API* below). Next routes follow `FEATURE.md`
* Development seed data used to write and test the API

Done:

* Database design, Prisma schema and first migration
* PostgreSQL setup (Docker)

Postponed:

* Job collector: work starts once the API can search the seeded offers. Until then the database is filled by the development seed.
* Full frontend (`apps/web`): built after the API. Until then a deliberately simple **test client** (`apps/test-client`) is used to try the API in a browser.

## Planned features

* Job offer collection from multiple sources
* Job search and filtering
* User accounts and professional profiles
* Resume management
* Automatic resume adaptation to job offers
* Resume PDF generation
* Job matching and recommendations
* Application tracking
* Cover letter generation

## Tech stack

### Frontend

* React
* Vite
* Two frontends, built at different times:
  * `apps/test-client` (now): a minimal client for testing the API by hand. Throwaway quality, no design work
  * `apps/web` (later): the real, complete user interface
* Single Page Application (SPA)
* Typescript

### Backend

* Node.js
* Express
* REST API
* Typescript

### Database

* PostgreSQL
* Prisma ORM

### Job collection

* Node.js
* Separate background process
* Crawlers / APIs
* Parsers and normalizers

## Architecture

The project is organized as a monorepo with separate applications for the frontend, backend API, and job collector, and a shared package used by the frontend and the API.

```text
.
├── apps/
│   ├── test-client/   # minimal React client for testing the API (now)
│   │
│   ├── web/           # complete frontend (later)
│   │   └── src/
│   │       ├── jobs/
│   │       ├── users/
│   │       ├── resumes/
│   │       └── applications/
│   │
│   ├── api/
│   │   └── src/
│   │       ├── jobs/
│   │       ├── users/
│   │       ├── resumes/
│   │       └── applications/
│   │
│   └── job_collector/
│       └── src/
│           ├── crawlers/
│           └── ...
│
├── packages/
│   └── shared/        # schemas, match formula, shared types (no I/O)
│
├── prisma/
│   ├── schema.prisma
│   └── migrations/
│
├── README.md
├── ARCHITECTURE.md
├── AI_CONTEXT.md
└── package.json
```

## Application flow

The React frontend communicates with the Express backend through a REST API.

```text
Browser
   ↓
React SPA
   ↓ HTTP / JSON
Express API
   ↓
Prisma
   ↓
PostgreSQL
```

The job collector runs independently:

```text
External Sources
      ↓
Job Collector
      ↓
PostgreSQL
```

The collector does not depend on the web application being open or running.

## Getting started

Requirements: Node.js 24.7 or later (built-in Argon2 password hashing), Docker. The repository pins Node 24 in `.nvmrc`.

```bash
nvm use
npm install
npm run db:up        # start PostgreSQL in Docker
npm run db:migrate   # apply the migrations and generate the Prisma client
npm run db:seed      # empty the database and insert the development data
npm run api:install-browser   # headless Chromium for PDF rendering (once)
```

Other scripts:

* `npm run api:dev` — start the API on http://localhost:3000 (restarts on change)
* `npm run client:dev` — start the test client on http://localhost:5173 (needs the API running); it proxies `/api` to the API
* `npm run api:test` — API integration tests (they expect the seed data: run `npm run db:seed` first)
* `npm run jobs:cleanup` — run the cleanup job once (the API also runs it every 24 h)
* `npm run db:reset` — drop everything, re-apply the migrations and reseed
* `npm run db:studio` — browse the data in Prisma Studio
* `npm run typecheck` — type-check the TypeScript code

### Development data

`npm run db:seed` (code in `prisma/seed/`) **empties every table** before inserting a fixed data set, so it can be re-run at any time. It contains:

* French locations at every level (country, regions, departments, cities with coordinates), plus Brussels for the "other country" case
* A small skill and occupation catalogue with French and English names (stand-in for the ESCO import)
* 200 offers: 180 generated from 24 job profiles (same data on every run) and 20 hand-written edge cases (region/department/country-level locations, remote offers, a closed offer, a private user offer, no skills, other currency, hourly/daily/monthly salaries, no published date, HTML in the description…). Published dates are relative to the time of seeding
* Users, each with a ready-made session so the API can be tested before login exists:

| User | Email / password | Session token | Content |
|---|---|---|---|
| demo | demo@example.com / demo-password | `dev-session-demo` | French resume (selected) + English translation, 7 saved offers with every status, search location Brunoy |
| alice | alice@example.com / alice-password | `dev-session-alice` | Nothing yet (no resume) |
| guest | — | `dev-session-guest` | Guest with one saved offer |

Ids of seeded rows (users, resumes, offers) are the same after every reseed.

The session token goes in the `session` cookie:

```bash
curl -H "Cookie: session=dev-session-demo" "http://localhost:3000/api/offers?q=react&locationId=1"
```

## API

All routes are under `/api`. Request and response types are in `packages/shared`. Errors are `{ "error": { "code", "message" } }`.

| Route | Feature | Notes |
|---|---|---|
| `GET /api/offers` | O1 | Search. Query: `q`, `locationId`, `radius`, `includeRemote`, `skills`, `company`, `remoteType`, `contractType`, `publishedWithin`, `salaryMin`, `salaryCurrency`, `salaryPeriod`, `salaryShownOnly`, `sort`, `page` |
| `GET /api/offers/:id` | O2 | `?lang=fr\|en` for skill/occupation names |
| `POST /api/user-offers/extract` | O5 | `{ url }` or `{ text }` → `{ draft }` to review, or `{ existingOfferId }` (known URL, saved for the user). **Placeholder extractor** |
| `POST /api/user-offers` | O5 | Create the private offer from the reviewed draft (saved automatically) |
| `PUT /api/user-offers/:id` | O5 | Creator only, while the offer is private |
| `GET /api/locations?q=` | O1 | Autocomplete from the `locations` table (Geoapify later) |
| `GET /api/auth/me` | — | Current user (or `null`) with the selected resume's skill/occupation ids |
| `POST /api/auth/signup` | A1, G2 | Upgrades the current guest if there is one |
| `POST /api/auth/login` | A2 | Merges the current guest's data into the account |
| `POST /api/auth/logout`, `/logout-all` | A3 | Registered users only |
| `POST /api/auth/password` | A7 | Logs out the other devices |
| `DELETE /api/auth/account` | A5 | Password confirmation |
| `GET /api/saved-offers` | O3 | `?status=`, `?sort=saved\|status_changed` |
| `PUT /api/saved-offers/:offerId` | O3 | Save (creates a guest on first write) |
| `PATCH /api/saved-offers/:offerId` | O3 | `status`, `notes`, `appliedAt` |
| `DELETE /api/saved-offers/:offerId` | O3 | Unsave |
| `GET /api/resumes`, `GET /api/resumes/:id` | R1 | Detail includes the catalogue links (M2) |
| `POST /api/resumes` | R2 | Create from scratch (ResumeContent v1 JSON) |
| `POST /api/resumes/upload?name=` | R2 | Body = the PDF/DOCX file. **Placeholder parser**: always returns the same sample resume |
| `PUT /api/resumes/:id` | R3 | Whole resume; re-extracts skills/occupations |
| `POST /api/resumes/:id/select`, `DELETE /api/resumes/:id` | R4, R5 | |
| `GET /api/resumes/:id/source` | R5 | Original uploaded file |
| `GET /api/photos`, `POST /api/photos?name=` | R6 | Upload body = the image (JPEG/PNG/WEBP); stored as WebP ≤ 1000 px without metadata |
| `PATCH /api/photos/:id`, `POST /api/photos/:id/select`, `DELETE /api/photos/:id` | R6 | Rename, select, soft delete |
| `DELETE /api/photos/selection` | R6 | "No photo" |
| `GET /api/photos/:id/file` | R6 | The image, owner only |
| `GET /api/templates` | S2 | Public |
| `GET /api/settings`, `PATCH /api/settings` | S1, S2 | Modifier defaults, template, UI language |
| `POST /api/generated-resumes` | M1 | Modifier off only (`501 ai_not_available` otherwise); `409 language_mismatch` with details |
| `GET /api/generated-resumes?offerId=`, `GET /api/generated-resumes/:id` | M3 | History and detail |
| `PATCH /api/generated-resumes/:id` | M3 | Change template or photo, edit content |
| `DELETE /api/generated-resumes/:id` | M3 | Soft delete |
| `GET /api/generated-resumes/:id/html`, `/pdf` | M3 | Rendered preview; PDF printed by headless Chromium |

Not built yet: AI (resume parsing, offer extraction and page fetching for O5, generation with the modifier, change review M4), translation (T1). Password reset (A4) and email verification (A6) are postponed (they need an email provider).

## Test client

`apps/test-client` is a bare React page for trying the API by hand: search (with location autocomplete and match %), add an offer (URL or pasted text, review, edit), offer detail (match details, generate a resume), saved offers, resumes (JSON editor, upload), photos, generated resumes (preview, template, photo, PDF, JSON editor), settings, and account actions (sign up, log in as a seeded user, log out, change password, delete account). A side panel lists every API request with its JSON response.

```bash
npm run api:dev
```

```bash
npm run client:dev
```

## Development

The applications are developed independently:

```text
React / Vite       → localhost:5173
Express API        → localhost:3000
PostgreSQL         → localhost:5432
```

The React application communicates with the Express API using HTTP requests.

The frontend and backend remain separate so that each can evolve independently.

## Database

PostgreSQL is the main persistent database.

Prisma is used as the ORM and database access layer.

The Prisma schema is located at:

```text
prisma/schema.prisma
```

Database structure changes are managed through Prisma migrations.

## Job Collector

The job collector is a separate application/process responsible for collecting job offers from external sources.

The intended processing flow is:

```text
External Source
      ↓
...
      ↓
PostgreSQL
```

The collector is designed to support multiple sources without making the database schema dependent on a specific source.

Source-specific information can be preserved as raw data when necessary.

### Current collector

The collector is postponed until the backend can search offers. Meanwhile the development seed (`prisma/seed/`) provides the offers.

Real crawlers and external job sources will be added later.

## Design principles

The project aims to remain simple and modular.

* React handles the user interface.
* Express handles the API and backend logic.
* PostgreSQL is the source of persistent application data.
* Prisma handles database access.
* The job collector runs independently from the web application.
* Business logic should remain separated from UI and data-access code.
* Logic needed by both the frontend and the API is written once in `packages/shared`.
* External job sources should be normalized into a common internal format.
* AI should complement the application rather than become a required part of every operation.
* Avoid unnecessary abstractions and dependencies until they are actually needed.

## Documentation

* `README.md` — Project overview, setup, and current status
* `ARCHITECTURE.md` — Technical architecture and design decisions
* `AI_CONTEXT.md` — Context and rules for AI-assisted development
* `FEATURE.md` — MVP feature specification
* `DATABASE.md` — Database design, JSON formats, search rules
* `claude/DECISIONS.md` — Decision log
* `prisma/schema.prisma` — Draft Prisma schema