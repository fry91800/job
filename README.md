# Job Platform

Web application for finding job offers, managing professional profiles and resumes, and automatically adapting resumes to job offers.

## Status

Early development / MVP.

Current focus:

* Job database
* Job model
* Job collector architecture
* PostgreSQL setup
* Test data insertion

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

The collector currently uses hardcoded test data to validate the complete flow from collection to database insertion.

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