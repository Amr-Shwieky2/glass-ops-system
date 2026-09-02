# Glass Operations Management System

A Next.js 16 (App Router) + React 19 + TypeScript operations app for a glass
company — customers, jobs, measurements, quotes with e-signature, factory
production, scheduling, job costs/compensation/cash/checks, repairs, vehicles,
users/permissions, and reporting. Fully Arabic (RTL) interface. See
`ARCHITECTURE.md` for the stack rationale and financial-integrity rules, and
`AGENTS.md` for this repo's Next.js 16 conventions.

## Getting started (local development)

Prerequisites: Node.js, and a local PostgreSQL 16 server.

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Configure the environment** — copy `.env.example` to `.env` and point
   `DATABASE_URL` at a Postgres database (created ahead of time, e.g.
   `createdb glass_ops`):

   ```bash
   cp .env.example .env
   # DATABASE_URL=postgres://user:password@localhost:5432/glass_ops
   ```

3. **Migrate the schema**

   ```bash
   npm run db:migrate
   ```

4. **Seed demo data**

   ```bash
   npm run db:seed
   ```

   This truncates and reseeds demo users, permissions, customers, jobs (in
   various workflow states), appointments, quotes, costs, checks, and more.
   Safe to rerun any time you want a clean, known starting point — every
   `scripts/verify-phaseN.mjs` script and the test suite below expect a
   freshly-seeded database.

5. **Run the dev server**

   ```bash
   npm run dev
   ```

   Open [http://localhost:3000](http://localhost:3000). The interface is in
   Arabic (RTL).

### Demo login credentials

All seeded users share the password `password123`:

| Phone | User | Role |
|---|---|---|
| `0501111111` | Amr | Super-admin (full permissions) |
| `0502222222` | Mohammad | — |
| `0503333333` | Issam | — |
| `0504444444` | Basel | — |

## Running the test suite

- **Unit tests** (Vitest — pure business logic: money, permissions, status
  transitions, CSV export, date/timezone helpers):

  ```bash
  npm run test
  ```

- **End-to-end tests** (Playwright — drives a real browser against the app,
  spec sections 87 and 72). Requires the dev server running at
  `http://localhost:3000` (`npm run dev` in another terminal) and a Chromium
  browser installed for Playwright (`npx playwright install chromium`):

  ```bash
  npx playwright test
  ```

- **Supplementary deep-coverage acceptance scripts**: `scripts/verify-phaseN.mjs`
  (N = 4 through 10b) are standalone, manual acceptance scripts — not part of
  either test runner above. Each drives a real headless browser against the
  seeded demo data and exits non-zero on failure. Run one directly with
  `node scripts/verify-phaseN.mjs` (e.g. `node scripts/verify-phase6.mjs`);
  reseed fresh (`npm run db:seed`) before each one, since they assert against
  the known seeded state.

Deployment is out of scope here — see Phase 12 / `DEPLOYMENT.md` (per
`ARCHITECTURE.md`'s deployment posture notes) once that's decided.
