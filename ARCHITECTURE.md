# Architecture

## Overview

Job Platform is a web application built around a React frontend, an Express backend, and a PostgreSQL database.

The project is organized as a monorepo with separate applications for the frontend, backend API, and job collector, plus one shared package for code that both the frontend and the backend need.

## Applications

### Web

The `web` application is the React SPA.

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

* Routes are under `/api` (the web app reaches them through the Vite proxy in development).
* Request parameters are validated with the Zod schemas from `packages/shared`.
* Errors are returned as `{ "error": { "code": "…", "message": "…" } }` with a stable `code`; validation errors also list `issues`.
* `req.user` is set when the request carries a valid `session` cookie; routes that require a user check it.
* SQL that Prisma's query builder cannot express (location matching, trigram search) is written with `Prisma.sql` tagged templates, never by concatenating strings.
* Tests use Node's test runner (`node --test`) and run against the seeded development database.
* TypeScript runs directly through `tsx`; there is no build step yet.

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