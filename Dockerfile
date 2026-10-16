# syntax=docker/dockerfile:1
# Production images (DEPLOYMENT.md): `api`, `worker` (job collector) and `web` (the built
# frontend served by Caddy, which also forwards /api to the API). The TypeScript server
# code runs with tsx, as in development: no separate build step.

FROM node:24.13.0-bookworm-slim AS deps
# OpenSSL before installing: Prisma picks its engine for the OpenSSL version it finds.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/job_collector/package.json apps/job_collector/
COPY apps/web/package.json apps/web/
COPY apps/test-client/package.json apps/test-client/
COPY packages/shared/package.json packages/shared/
COPY packages/backend/package.json packages/backend/
RUN npm ci --no-audit --no-fund

# Server code (API and collector) with the generated Prisma client.
FROM deps AS server
COPY tsconfig.json prisma7.config.ts ./
COPY prisma prisma
COPY packages packages
COPY apps/api apps/api
COPY apps/job_collector apps/job_collector
RUN DATABASE_URL=postgresql://build@localhost/build npx prisma generate --config prisma7.config.ts
ENV NODE_ENV=production

FROM server AS api
# Headless Chromium for PDF resumes, with its system libraries. `prisma migrate deploy`
# checks that its engine folder is writable (it downloads nothing): owned by the user.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npx playwright-core install --with-deps chromium-headless-shell \
  && mkdir -p /data/storage \
  && chown -R node:node /data/storage /app/node_modules/.prisma /app/node_modules/@prisma/engines
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s CMD node -e "fetch('http://localhost:3000/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
# The database schema is brought up to date before the API starts.
CMD ["sh", "-c", "npx prisma migrate deploy --config prisma7.config.ts && exec node --import tsx apps/api/src/server.ts"]

FROM server AS worker
USER node
CMD ["node", "--import", "tsx", "apps/job_collector/src/main.ts"]

FROM deps AS web-build
COPY tsconfig.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN npx vite build apps/web

FROM caddy:2.10-alpine AS web
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=web-build /app/apps/web/dist /srv
