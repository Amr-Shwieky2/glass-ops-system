# syntax=docker/dockerfile:1
#
# Multi-stage build for self-hosting via Docker Compose (ARCHITECTURE.md
# section 9). `next.config.ts` sets `output: "standalone"`, so the final
# image only needs the traced server bundle, not the full source tree or
# a full `node_modules` install.
#
# Stages:
#   deps    - install npm dependencies (cached separately from source changes)
#   builder - copy source, run `next build` (produces .next/standalone)
#   runner  - slim runtime image: standalone server + Playwright Chromium
#             (for PDF generation, ARCHITECTURE.md section 7) + an isolated
#             drizzle-kit install used only to run migrations on startup

ARG NODE_IMAGE=node:22-slim

# ---------------------------------------------------------------------------
# deps: install all dependencies from the lockfile
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---------------------------------------------------------------------------
# builder: build the Next.js app
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# `next build` needs a DATABASE_URL to resolve (drizzle client construction
# happens at module scope in some server files); no real connection is
# made during the build, so any well-formed value is fine here.
ENV DATABASE_URL="postgres://build:build@localhost:5432/build"
RUN npm run build

# ---------------------------------------------------------------------------
# runner: minimal production image
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# `curl` for the container HEALTHCHECK below (and for anyone shelling in to
# poke the app manually).
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

# Only the traced standalone server + the assets it doesn't bundle itself
# (public/, .next/static) — deliberately NOT the full source or node_modules
# (the whole point of output: "standalone").
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Playwright's Chromium + its OS-level shared libraries, installed at build
# time so self-hosting needs no extra service or key (ARCHITECTURE.md
# section 7, a documented Phase 1 decision). `playwright-core` isn't
# reliably carried into .next/standalone/node_modules by Next's output-file
# tracing even though src/server/pdf/render.ts imports it directly, so copy
# the package explicitly rather than assume it survived tracing — it has
# zero dependencies of its own, so this is a plain, self-contained
# directory copy.
COPY --from=builder /app/node_modules/playwright-core ./node_modules/playwright-core
RUN node node_modules/playwright-core/cli.js install --with-deps chromium \
    && chmod -R a+rX "$PLAYWRIGHT_BROWSERS_PATH"

# drizzle-kit is a devDependency (migration tooling, not app runtime code),
# so it is deliberately absent from the standalone build above. Install it
# into its own directory, pinned to the versions package.json declares, so
# it never mixes with — or bloats — the traced app node_modules. `migrate`
# only replays the pre-generated SQL in drizzle/migrations; it does not
# need the TypeScript schema or the rest of the source tree.
COPY drizzle.config.ts ./migrate/drizzle.config.ts
COPY drizzle ./migrate/drizzle
# An empty package.json makes /app/migrate its own npm project root — without
# it, npm walks up to the standalone server's /app/package.json (an
# ancestor directory) and installs there instead, defeating the isolation
# this directory is for.
RUN echo '{}' > migrate/package.json \
    && cd migrate && npm install --no-save \
      drizzle-kit@0.31.10 drizzle-orm@0.45.2 pg@8.23.0

RUN chown -R node:node /app "$PLAYWRIGHT_BROWSERS_PATH"
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS "http://localhost:${PORT}/login" || exit 1

# Run pending migrations (idempotent — safe on every container start; see
# drizzle-kit's migrations-journal bookkeeping in drizzle/migrations/meta),
# then start the Next.js server. Deliberately does NOT run `db:seed` here —
# it truncates data and must stay a manual, documented step.
ENTRYPOINT ["/bin/sh", "-c", "set -e; echo 'Running database migrations...'; (cd /app/migrate && node node_modules/drizzle-kit/bin.cjs migrate); echo 'Starting Next.js server...'; exec node server.js"]
