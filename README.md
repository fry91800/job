# Job Platform

Web application for finding job offers, managing professional profiles and resumes, and automatically adapting resumes to job offers.

## Status

Early development / MVP.

Current focus:

* Backend API (Express): offer search (`GET /api/offers`) is done; next routes follow `FEATURE.md`
* Development seed data used to write and test the API

Done:

* Database design, Prisma schema and first migration
* PostgreSQL setup (Docker)

Postponed:

* Job collector: work starts once the API can search the seeded offers. Until then the database is filled by the development seed.

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
│   ├── web/
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

Requirements: Node.js 20.19 or later (Prisma 7), Docker. The repository pins Node 24 in `.nvmrc`.

```bash
nvm use
npm install
npm run db:up        # start PostgreSQL in Docker
npm run db:migrate   # apply the migrations and generate the Prisma client
npm run db:seed      # empty the database and insert the development data
```

Other scripts:

* `npm run api:dev` — start the API on http://localhost:3000 (restarts on change)
* `npm run api:test` — API integration tests (they expect the seed data: run `npm run db:seed` first)
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