# AI Context

## Project

MonPoste (monposte.com, formerly "Job Platform") is a web application for finding job offers, managing professional profiles and resumes, and automatically adapting resumes to job offers.

The project is currently in early development.

## Current focus

The current priority is the backend API (Express), starting with offer search (FEATURE O1).

The database is filled by the development seed (`prisma/seed/`, `npm run db:seed`). The job collector is postponed: do not work on it unless explicitly requested.

Each API route gets integration tests next to it (`*.test.ts`, run with `npm test`, which uses the separate `job_test` database).

When a feature needs test data the seed does not have, add it to the seed (as a hand-written edge case if it tests a specific rule) instead of inserting rows by hand.

Do not implement future features unless explicitly requested.

## Tech stack

* React
* Vite
* Node.js
* Express
* REST API
* PostgreSQL
* Prisma

The frontend and backend are separate applications.

## Project structure

```text
apps/
├── test-client/    # minimal React client to test the API by hand
├── web/            # complete frontend (later)
├── api/            # Express API (see ARCHITECTURE.md for its layout and conventions)
└── job_collector/

packages/
├── shared/        # pure TypeScript shared by web and api (schemas, match formula, ingestion contract)
└── backend/       # server code shared by api and job_collector (Prisma client, matcher, locations, queues)

prisma/
├── schema.prisma
└── migrations/
```

## Reference documents

* `FEATURE.md` — feature specification (IDs such as O4, M1 are used in code and reviews)
* `DATABASE.md` — database design and JSON formats
* `COLLECTOR.md` — job collector plan (sources, ingestion contract, pipeline)
* `FRONTEND.md` — plan of the real frontend (`apps/web`): workspace layout with tabs, style, smoothness requirements
* `claude/DECISIONS.md` — decision log
* `ARCHITECTURE.md` — technical architecture

## Development rules

Keep the code simple and readable.

* Do not add unnecessary libraries.
* Do not introduce complex abstractions without a reason.
* Do not refactor unrelated code.
* Prefer small, focused modules.
* Keep responsibilities separated.
* Reuse existing code when appropriate.
* Avoid duplicating business logic. Logic needed by both web and api goes in `packages/shared`.
* Use clear and descriptive names.
* Handle errors explicitly.

## Database rules

PostgreSQL is the source of persistent data.

Prisma is the ORM/database access layer.

Use `prisma/schema.prisma` as the main definition of the database structure.

Use Prisma migrations when changing the database schema.

Do not introduce another ORM or database unless explicitly requested.

## API rules

The Express application is responsible for backend logic and the REST API.

Routes should remain simple and focused.

Business logic should not be unnecessarily placed directly inside route handlers.

## Frontend rules

There are two frontends (see ARCHITECTURE.md):

* `apps/test-client` (now): keep it **as simple as possible**. Its only purpose is to call the API and show the results. No styling beyond the bare minimum, no i18n, no extra libraries, no abstractions. Do not spend effort on UX.
* `apps/web` (later): the real frontend, planned in `FRONTEND.md`. Do not start it unless explicitly requested. The rules below are for it.

React is responsible for the user interface.

Keep components reasonably small and focused.

Do not put backend or database logic in the frontend. Pure computations from `packages/shared` (such as the match % formula) are allowed.

The frontend communicates with the backend through the REST API.

## AI development rules

Before making a significant architectural change:

1. Explain the proposed approach.
2. Explain which files would change.
3. Explain why the change is necessary.

For small changes, make the smallest reasonable modification.

Do not introduce functionality that was not requested.

When fixing a bug, identify the cause before changing unrelated code.

When possible, verify that the implementation works after making changes.