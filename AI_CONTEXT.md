# AI Context

## Project

Job Platform is a web application for finding job offers, managing professional profiles and resumes, and automatically adapting resumes to job offers.

The project is currently in early development.

## Current focus

The current priority is the job database and the basic job collector.

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
├── web/
├── api/
└── job_collector/

prisma/
├── schema.prisma
└── migrations/
```

## Development rules

Keep the code simple and readable.

* Do not add unnecessary libraries.
* Do not introduce complex abstractions without a reason.
* Do not refactor unrelated code.
* Prefer small, focused modules.
* Keep responsibilities separated.
* Reuse existing code when appropriate.
* Avoid duplicating business logic.
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

React is responsible for the user interface.

Keep components reasonably small and focused.

Do not put backend or database logic in the frontend.

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
