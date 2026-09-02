# Architecture — Glass Operations Management System

This document is the Phase 1 deliverable: the concrete free/open-source
stack, why each piece was chosen, and what changed from the "obvious"
choice when reality (a sandboxed build environment, current package
versions, and current hosting free-tier terms) pushed back.

## 1. Stack at a glance

| Concern | Choice | License / cost |
|---|---|---|
| Framework | Next.js 16 (App Router), React 19, TypeScript | MIT, free |
| Database | PostgreSQL 16 | PostgreSQL license, free |
| ORM | Drizzle ORM + drizzle-kit + `pg` (node-postgres) | MIT/Apache-2.0, free |
| Auth | Hand-rolled cookie sessions (bcryptjs + a `sessions` table) | free |
| Styling | Tailwind CSS v4 | MIT, free |
| UI primitives | Radix UI (via shadcn-style components), lucide-react icons | MIT, free |
| Forms/validation | react-hook-form + Zod | MIT, free |
| Calendar | FullCalendar core + daygrid/timegrid/interaction/list (MIT plugins only) | MIT, free |
| E-signature | react-signature-canvas | MIT, free |
| PDF generation | Playwright (headless Chromium) rendering an HTML template | Apache-2.0, free |
| Money | Postgres `numeric` columns + decimal.js, never JS floats | MIT, free |
| Testing | Vitest (unit) + Playwright Test (e2e) | MIT/Apache-2.0, free |
| Self-hosting | Docker Compose (Postgres + app + worker) | free |
| Optional live hosting | Decided in Phase 12 once the app is complete — see note below | — |

Every one of these runs completely free, self-hosted, with no API key and
no credit card. Nothing essential depends on a paid SaaS.

## 2. Why Drizzle instead of Prisma

The original plan was Prisma (it's the most familiar TypeScript ORM). In
practice, in this build environment:

- `npm install prisma@latest` resolved to `8.0.0-rc.12` — a **release
  candidate**, not the current stable (`7.10.0`). Pinning the stable
  version fixed that, but surfaced a second problem:
- Prisma 7's `generate`/`migrate`/`init` all need to download a native
  "schema-engine" binary from `binaries.prisma.sh` (and this holds for the
  legacy `prisma-client-js` generator too, not just the new one). That host
  is not reachable from this build sandbox (confirmed via direct `curl`,
  and via `PRISMA_ENGINES_MIRROR` pointed at a public mirror — both refused
  the connection outright), so no Prisma CLI command that touches the
  schema could run here at all, on any version.
- Prisma 7 also now *requires* a driver adapter (`@prisma/adapter-pg`) and
  a custom generator `output` path, and its own CLI has some internal
  inconsistency around the current config filename (`prisma.config.ts` vs.
  `prisma7.config.ts` — shipped code and published docs disagreed).

Drizzle ORM has none of this: `drizzle-kit generate`/`migrate` are pure
JavaScript, no binary download, ever. That's not just a workaround for
this sandbox — it's a genuine portability win the deployed app keeps too:
one less external CDN dependency at build time, which matters directly for
"must be capable of running locally/self-hosted" (section 1, rule 12).
Money columns are still plain Postgres `numeric`, returned as strings (via
`pg`'s default type parsing) and handled exclusively through
`src/server/money.ts` (decimal.js) — never a JS float.

## 3. Why Next.js 16 conventions matter here

`create-next-app@latest` scaffolded Next 16.3.4 / React 19.2.8, which is
newer than typical training data and ships its own
`node_modules/next/dist/docs/` with an explicit breaking-changes warning.
The concrete things this codebase relies on because of that:

- `params`/`searchParams` in pages and route handlers are **Promises**,
  always awaited.
- `cookies()`/`headers()` (from `next/headers`) are **async**.
- Prisma-style/Drizzle DB calls are **never** part of Next's fetch cache —
  only `fetch()` responses are cached — so a Server Component that calls
  `db.select()...` always sees the latest committed row after a Server
  Action mutation. No `revalidatePath`/`unstable_cache` gymnastics needed
  for data freshness anywhere finance-related.
- `middleware.ts` is deprecated in favor of `proxy.ts` (`export function
  proxy(request)`), Node.js runtime only. It is used **only** to redirect
  an unauthenticated browser away from a protected page — it is
  **never** the sole authorization check. Every Server Action and Route
  Handler independently calls `requirePermission()` from
  `src/server/auth/permissions.ts` before touching the database, because a
  proxy matcher exclusion does not protect a Server Action (confirmed in
  Next's own `data-security.md`).
- Docker self-hosting uses the unchanged `output: "standalone"` +
  `next start` path — no special adapter needed.

## 4. Authorization architecture

Permissions are granular, independently assignable, and enforced
server-side only (section 7/75):

- `permissions` — the full catalogue (`src/server/auth/permission-keys.ts`
  is the single source of truth for every key; nothing else in the app
  invents one at runtime).
- `user_permissions` — which user has which permission, grantable/
  revocable independently by an admin.
- `can(user, PERMISSIONS.X)` / `requirePermission(user, PERMISSIONS.X)` —
  the only functions anything calls to decide "is this allowed". Every
  Server Action and Route Handler calls one of these *first*, before any
  database write. The frontend hiding a button is a courtesy, never the
  actual gate.
- Nothing branches on a user's name or id. `if (user.name === "Mohammad")`
  does not exist anywhere in this codebase; permission profiles are data
  (seeded per section 8), not code.

Authentication is a custom cookie-session scheme (not NextAuth/Auth.js):
phone + password login, `bcryptjs` hashing, a `sessions` table storing
only a SHA-256 hash of the session token (the raw token lives only in the
browser's httpOnly cookie), so a leaked DB row can't be replayed. This
keeps full control over the permission-heavy authorization model without
taking on an auth library's own version churn.

## 5. Money and financial integrity

Every balance in this system is **computed from transaction rows**, never
stored as a mutable running total (section 74):

- Customer paid / remaining balance ← `SUM(customer_payments.amount)`
  where `approval_status = 'approved'`.
- Cash-box balance per employee ← `SUM(cash_transactions)` for their
  account (never edited directly; only a confirmed `cash_transfer` posts
  the matching in/out pair).
- Technician balance ← `SUM(technician_ledger_entries.amount)` where
  approved, sign convention: earnings/bonuses/reimbursements positive,
  penalties/payments-made negative.
- Job cost / profitability ← `SUM(job_costs.amount)` where approved
  (`Revenue - Confirmed Cost`).

Labor cost is the one place two tables describe the same economic event on
purpose: an installer's compensation is both money the company owes *that
person* (`technician_ledger_entries`) and a cost incurred *by the job*
(`job_costs`, category `installer_labor`/`daily_worker_labor`). Both rows
are written in one transaction by one service call
(`src/server/compensation/ledger.ts`), linked by `job_costs.ledger_entry_id`,
so they can never be created independently and drift apart.

The full worked example from the spec (Sale 12,000 / Factory 3,200 /
Hardware 1,000 / Issam 1,250 / Basel 450 → Total Cost 5,900 → Gross Profit
6,100 → 10% commission 610) is seeded verbatim and verified by direct SQL
query to reproduce those exact figures — see the seed script.

## 6. Quote version immutability

`quotes` is an identity shell; `quote_versions` holds the actual
items/prices/terms and is **append-only** — application code never updates
a version row after creation (the one narrow exception is attaching a
`quote_signatures` row at the moment of signing). Any post-send edit —
price, items, quantities, terms — creates version N+1; the signed version
(`quotes.signed_version_id`) is never touched again. PDF generation and the
public signing page always render a specific `quote_version_id`, so a
signed PDF corresponds exactly to what the customer agreed to, forever.

## 7. PDF and e-signature, without a paid service

PDFs are generated by rendering an HTML template (company info, quote
items, terms, signature if signed) and printing it with headless Chromium
via Playwright (`page.pdf()`) — real browser text layout, which matters
because the UI language is Arabic (RTL, contextual letter shaping);
`@react-pdf/renderer`-style libraries have historically shaky Arabic
shaping, whereas Chromium's own text engine handles it natively. Locally
this reuses the sandbox's pre-installed Chromium; the Docker image
installs Chromium at build time (`playwright install --with-deps
chromium`) so self-hosting needs no extra service or key. E-signatures are
captured with `react-signature-canvas` (mouse/touch), stored as a base64
PNG directly in `quote_signatures.signature_image` — no object storage
needed at V1's scale.

## 8. Language: Arabic, i18n-ready

The interface is Arabic (RTL) throughout — `dir="rtl"`, an Arabic web font
loaded via `next/font/google` (self-hosted at build time, no runtime
Google dependency), Tailwind logical properties (`ps-*`/`pe-*`/`ms-*`/
`me-*`, not `left`/`right`) so layout mirrors correctly. All user-facing
copy lives behind a small dictionary layer rather than inline strings, so
adding a second language later is additive, not a rewrite. Money is always
formatted with Western (`latn`) digits even in Arabic text — financial
amounts should never be ambiguous — see `src/server/money.ts`.

## 9. Deployment posture

The system must run without depending on any paid service (section 1).
Concretely:

- **Self-hosted (primary, always free):** `docker compose up` — Postgres +
  the Next.js app (+ a small worker container for scheduled notification
  sweeps) on any machine the company controls. No account, no card, no
  usage cap, ever.
- **A live URL on a free cloud tier (Phase 12, decided with the user once
  the app is complete):** researched and explicitly **not** defaulting to
  Vercel's Hobby plan — its fair-use terms restrict Hobby to
  "non-commercial personal use", and this is a real company's paid
  operations data, which Vercel's own terms count as commercial use
  regardless of who's paying. Free-tier terms move fast enough (Neon
  restructured its free tier in January 2026; Render changed its free-tier
  shape multiple times through 2026) that the specific provider is picked
  and documented at deploy time in `DEPLOYMENT.md`, not locked in here —
  see rule 12 (keep it portable).

## 10. Repository layout (as it fills in)

```
src/
  app/                 Next.js routes (App Router)
  server/
    db/
      schema/          Drizzle schema, one file per domain + relations.ts
      client.ts        Pooled Postgres connection (server-only)
      seed.ts          Idempotent demo data (section 86)
    auth/              Sessions, permissions, password hashing
    jobs/ quotes/ ...   Domain service modules (business logic + validation)
    money.ts           Decimal-safe arithmetic — the only place that adds money
    settings*.ts        Typed accessors for admin-configurable business rules
  components/          Shared UI (design system, section 78)
drizzle/migrations/    Generated SQL migrations
```

## 11. Known accepted risk

`npm audit` reports moderate/high findings in `prisma`'s and `drizzle-kit`'s
own **CLI dev-tooling** transitive dependencies (a bundled MySQL driver
and config-merge library neither product uses against this Postgres-only
app, and esbuild's dev-server which this project never runs in serve mode).
None of these ship in the production Docker image — only `@prisma`-free,
plain `drizzle-orm` + `pg` do. Downgrading either CLI to silence them would
mean running an older major version for no real security benefit; this
trade-off is intentional and documented rather than hidden.
