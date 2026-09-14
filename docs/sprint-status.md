# Sprint 0 Current-State Report — Glass Operations Management System

Repo: `/Users/shwie/Downloads/glass-ops-system-source` (standalone repo, not a monorepo). Report date: 2026-09-14 (audit ran in two halves across a 5-day gap: 9 of 22 agents Sep 9, resumed and completed Sep 14 — cached results reused for anything unchanged). Companion document: `requirements-matrix.md` (same directory) — this report's "Requirement coverage counts" and "Remaining gaps" sections summarize that matrix; see it for row-by-row evidence. **Sprint 1 (security hardening) landed the same day — see `requirements-matrix.md`'s "Sprint 1 changelog" section at the top for what changed; everything below this line is the unedited Sprint 0 snapshot.**

## Framework / stack

- **Next.js — a modified fork, not stock.** `AGENTS.md` (loaded as project instructions via `CLAUDE.md`) states explicitly: *"This is NOT the Next.js you know... APIs, conventions, and file structure may all differ from your training data."* The routing/middleware layer is called **Proxy** (`src/proxy.ts`), not classic Next.js Middleware — it does a cookie-presence redirect only and explicitly excludes `/api` and `/public` from its matcher; it is documented in-repo as *not* the authorization boundary.
- **Language/runtime:** TypeScript, React (Server Components-first; `src/app` uses the App Router convention with `(app)`/`(public)` route groups).
- **Database:** PostgreSQL, accessed via **Drizzle ORM** (`src/server/db/`), parameterized queries throughout (no raw string-interpolated SQL found in a repo-wide audit).
- **Auth:** custom session implementation (`src/server/auth/session.ts`) — bcrypt (`bcryptjs`, 12 rounds) password hashing, SHA-256-hashed random session tokens in httpOnly/sameSite cookies, no third-party auth provider.
- **Money:** `decimal.js` wrapped in `src/server/money.ts`; every monetary DB column is `numeric(12,2)` (or `numeric(5,2)` for percentages) — zero float/real/money-typed columns in the schema.
- **Validation:** `zod` on every Server Action input.
- **PDF rendering:** `playwright-core` driving a headless Chromium instance server-side (`src/server/pdf/render.ts`) — no paid PDF/document service.
- **AI:** local **Ollama** (`qwen2.5:3b` by default, `http://localhost:11434`) for AI-assisted Hebrew quote drafting only; no paid LLM API anywhere in the codebase (repo-wide grep for `openai`/`anthropic`/`api_key`: 0 hits).
- **Calendar:** `@fullcalendar/*` (day/week/month/list views).
- **UI:** Radix UI primitives + Tailwind CSS, `Cairo` Arabic web font, `dir="rtl" lang="ar"` set at the document root.
- **Testing:** `vitest` (unit) + `@playwright/test` (e2e, Chromium only).
- **Deployment:** Docker (multi-stage `Dockerfile`, `next build` standalone output) + `docker-compose.yml` (postgres + app services only — **no worker/scheduler service**, self-documented as a known gap in the compose file's own header comment).
- **No paid dependencies anywhere:** `package.json` contains only MIT/Apache-2.0/PostgreSQL-licensed OSS (Next.js, Radix, Drizzle, `pg`, `react-hook-form`, `zod`, `decimal.js`, `playwright-core`, `recharts`, `date-fns`, `bcryptjs`, `nanoid`, `sonner`, Tailwind, `vitest`, `eslint`, `prettier`, `typescript`, `@fullcalendar/*`).

## Directory structure (top 2 levels, with purpose)

```
glass-ops-system-source/
├── src/
│   ├── app/                 Next.js App Router routes.
│   │   ├── (app)/           Authenticated app shell + every internal page.tsx
│   │   │                    (dashboard, my-day, jobs, customers, calendar,
│   │   │                    quotes, production, repairs, vehicles, finance,
│   │   │                    approvals, reports, search, admin/*, settings)
│   │   │                    plus co-located client components / dialogs / actions.
│   │   ├── (public)/        Public, unauthenticated routes: /login only
│   │   │                    (public/q, public/pr live under app/public, not here).
│   │   ├── public/          Token-gated public pages with no login required:
│   │   │                    /public/q/[token] (quote signing), /public/pr/[token]
│   │   │                    (factory submission), shared public/layout.tsx.
│   │   └── api/              6 Route Handlers: appointments, attachments/[id],
│   │                        notifications, quotes/[quoteId]/pdf,
│   │                        public/quotes/[token]/pdf, reports/[report].
│   ├── server/               All business logic — Server Actions, queries,
│   │   │                    and domain services. ~26 subdirectories, one per
│   │   │                    domain (auth/, jobs/, quotes/, production/,
│   │   │                    payments/, costs/, compensation/, finance/,
│   │   │                    appointments/, repairs/, vehicles/, fuel/,
│   │   │                    checks/, customers/, measurements/, lookups/,
│   │   │                    users/, ai/, pdf/, storage/, audit/, dashboard/,
│   │   │                    reports/, approvals/, db/) plus top-level
│   │   │                    money.ts, notifications.ts, numbering.ts,
│   │   │                    search.ts, tokens.ts, settings.ts, audit.ts.
│   │   └── db/               schema/ (13 files, 46 tables), seed.ts (1218 lines,
│   │                        4 demo personas + realistic demo data).
│   ├── components/           Shared UI (ui/ = Radix wrappers; location-buttons,
│   │                        signature-pad, empty-state, etc.).
│   ├── lib/                  Cross-cutting helpers: money-adjacent formatting,
│   │                        company-day.ts (Asia/Jerusalem date helper),
│   │                        location-links.ts, quote-i18n.ts.
│   ├── config/                nav.ts (14 permission-gated nav items).
│   └── proxy.ts               Cookie-presence redirect only (not the authz boundary).
├── drizzle/
│   └── migrations/           9 migration files (0000–0008) + meta/_journal.json.
├── scripts/                  backup.sh, restore.sh, 13 verify-*.mjs acceptance
│                             scripts (not part of `npm test`/`npm run test:e2e`).
├── tests/
│   └── e2e/                  8 Playwright spec files + fixtures.ts.
├── docs/                     Design/spec docs (e.g. superpowers/specs/*.md).
├── Dockerfile, docker-compose.yml, .env.example, .env.docker.example
├── README.md, ARCHITECTURE.md, DEPLOYMENT.md
└── AGENTS.md, CLAUDE.md      Project-level agent instructions (Next.js-fork notice).
```

## Database tables (all 46, grouped, with enums) and migrations

**Migrations:** 9 files, `0000_fair_sir_ram.sql` … `0008_bumpy_rocket_raccoon.sql`, all 9 recorded in the live DB's `drizzle.__drizzle_migrations` table with ids/hashes/timestamps matching `meta/_journal.json` 1:1.

| Schema file | Tables (46 total) |
|---|---|
| `auth.ts` (4) | users, permissions, user_permissions, sessions |
| `customers.ts` (1) | customers |
| `jobs.ts` (5) | jobs, job_items, job_assignments, measurements, measurement_attachments |
| `contractors.ts` (1) | external_contractors |
| `appointments.ts` (2) | appointments, appointment_assignees |
| `repairs.ts` (1) | repairs |
| `vehicles.ts` (3) | vehicles, vehicle_responsibility_history, fuel_logs |
| `quotes.ts` (5) | quotes, quote_versions, quote_items, quote_signatures, quote_public_links |
| `production.ts` (3) | production_requests, factory_submissions, factory_public_links |
| `finance.ts` (8) | job_costs, customer_payments, cash_accounts, cash_transactions, cash_transfers, cash_expense_reports, incoming_checks, outgoing_checks |
| `compensation.ts` (2) | technician_ledger_entries, commissions |
| `system.ts` (3) | approval_requests, notifications, audit_logs |
| `lookups.ts` (8) | job_statuses, work_types, glass_types, compensation_rules, penalty_rules, bonus_rules, application_settings, number_sequences |

**Enums (19):**

| Enum | Values |
|---|---|
| user_status | active, suspended |
| approval_status | pending, approved, rejected (shared by all `approvable_entity_type` flows) |
| quote_status | draft, sent, signed, expired, superseded (`expired`/`superseded` are never written by any live code path) |
| quote_language | ar, he |
| factory_status | pending, submitted, approved, rejected |
| job_item_status | pending, in_production, ready, installed, cancelled |
| appointment_type | 5 values (measurement/installation/repair + 2 more) |
| appointment_status | scheduled, arrived, completed, cancelled |
| repair_status | 4 values (open→scheduled→in_progress→resolved, never automatic) |
| fuel_type | 5 values |
| payment_method | cash, bank_transfer, check, other |
| incoming_check_status | future, due_soon, deposited, cleared, failed, cancelled |
| outgoing_check_status | pending, issued, cleared, failed, cancelled |
| job_cost_category | 8 values (incl. factory_glass, installer_labor, daily_worker_labor, external_contractor, aluminum_contractor, hardware, fuel + 1 more) |
| ledger_entry_type | installation_earning, daily_wage, bonus, penalty, commission, fuel_reimbursement, vehicle_usage_deduction, payment_made, other_adjustment (9) |
| cash_account_owner_type | user, company |
| cash_direction | in, out |
| commission_status | estimated, finalized |
| approvable_entity_type | customer_payment, technician_ledger_entry, factory_submission, job_cost, cash_expense_report (5) |

No DB triggers, no CHECK constraints beyond FKs/uniques, and — notably — **no `balance`/`paid`/`remaining`/`total` column exists anywhere in the schema**: every derived financial figure is computed by `SUM()` at read time through `src/server/money.ts` (verified by a live `information_schema.columns` scan). `jobs.sale_price_total` is the one persisted "total," and it is written exactly once, by `applySignedQuoteToJob` (`src/server/quotes/convert.ts:69`), from the signed quote version's total.

## Permission list (32 keys, with seeded per-user sets)

All 32 keys, live-verified against `permissions` (count = 32) and cross-checked against `PERMISSION_CATALOGUE` in `src/server/auth/permission-keys.ts`. 29 are spec-named; **3 are documented extensions**: `manage_settings`, `view_audit_log`, `manage_job_costs`.

| Category | Keys |
|---|---|
| Customers | view_customers, create_customer, edit_customer |
| Jobs | view_all_jobs, view_assigned_jobs |
| Measurement | create_measurement, edit_measurement *(seeded to 2 users, enforced nowhere — see R1.14)* |
| Pricing/Quoting | create_price, edit_price, create_quote, send_quote, close_deal |
| Payments | collect_payment, approve_payment |
| Production | create_production_order, approve_factory_price |
| Assignment | assign_installer |
| Financial visibility | view_profitability, view_job_costs, view_technician_balances |
| Financial management | manage_technician_payments, approve_requests, manage_checks, manage_job_costs |
| Field ops | create_repair, complete_installation, add_fuel |
| Vehicles | manage_vehicles |
| Admin | manage_users, manage_permissions, manage_settings, view_audit_log |

**Seeded per-user permission sets** (`src/server/db/seed.ts`, live-verified via `user_permissions` on 2026-09-14, exact match — set equality — for all 4 users):

| User | Phone | Grants (of 32) | Keys |
|---|---|---|---|
| عمرو (Amr) — Super Admin | +972501111111 | **32/32** | all keys |
| محمد (Mohammad) — Commercial/Manager | +972502222222 | **25** | view_customers, create_customer, edit_customer, view_all_jobs, view_assigned_jobs, create_measurement, edit_measurement, create_price, edit_price, create_quote, send_quote, close_deal, collect_payment, approve_payment, create_production_order, approve_factory_price, assign_installer, view_profitability, view_job_costs, view_technician_balances, manage_technician_payments, approve_requests, manage_checks, manage_job_costs, create_repair |
| عصام (Issam) — Measurement/Sales | +972503333333 | **12** | view_customers, view_assigned_jobs, create_measurement, edit_measurement, create_price, edit_price, send_quote, close_deal, collect_payment, complete_installation, add_fuel, create_repair |
| باسل (Basel) — Installer/Technician | +972504444444 | **7** | view_customers, view_assigned_jobs, create_measurement, complete_installation, collect_payment, add_fuel, create_repair |

All demo passwords: `password123`. `getCurrentUser()` (`src/server/auth/session.ts`) re-reads `user_permissions` from the DB **on every request** (`react cache()` is per-render only, not cross-request) — so a permission revocation takes effect on the very next request, not merely on next login.

## Important pages (page.tsx routes with permission gates)

28 `page.tsx` routes. Gate column reflects the actual server-side check found in source; "❌ none" flags a confirmed missing gate.

| Route | Gate |
|---|---|
| /login | public |
| /public/q/[token] | public, token-gated |
| /public/pr/[token] | public, token-gated |
| /dashboard | canAny(VIEW_ALL_JOBS, VIEW_ASSIGNED_JOBS) |
| /my-day | any authenticated user (own assignments only); action buttons individually permission-gated |
| /my-day/new-measurement | CREATE_MEASUREMENT |
| /jobs | canAny(VIEW_ALL_JOBS, VIEW_ASSIGNED_JOBS), involvement-scoped |
| /jobs/[id] | VIEW_ALL_JOBS **or** job involvement (measuredBy/pricingResponsible/dealClosedBy/assignment) |
| /jobs/new | job-creation flow (gate not independently re-derived by any verifier in this audit) |
| **/customers** | **❌ none** — only the "add customer" button is gated (CREATE_CUSTOMER); the list itself is open to any authenticated user (S1.1, SECURITY ISSUE) |
| /customers/[id] | VIEW_CUSTOMERS **only** — no job-involvement scoping (R1.15, SECURITY ISSUE) |
| /calendar | canAny(VIEW_ALL_JOBS, VIEW_ASSIGNED_JOBS) |
| /quotes | canAny(CREATE_QUOTE, SEND_QUOTE, CLOSE_DEAL, VIEW_ALL_JOBS); list itself has no involvement filter |
| /production | canAny(CREATE_PRODUCTION_ORDER, APPROVE_FACTORY_PRICE) |
| **/repairs** | CREATE_REPAIR **only** — no involvement scoping (R1.32, SECURITY ISSUE) |
| /vehicles, /vehicles/[id] | canAny(MANAGE_VEHICLES, ADD_FUEL) |
| /finance | canAny(VIEW_TECHNICIAN_BALANCES, MANAGE_TECHNICIAN_PAYMENTS, MANAGE_CHECKS, COLLECT_PAYMENT, APPROVE_PAYMENT); own-row-only for non-managers |
| /finance/technicians | VIEW_TECHNICIAN_BALANCES, else redirected to own ledger |
| /finance/technicians/[userId] | own page (user.id === userId) **or** VIEW_TECHNICIAN_BALANCES |
| /approvals | APPROVE_REQUESTS |
| /reports | per-tab: jobs/customers → VIEW_ALL_JOBS; technicians → VIEW_TECHNICIAN_BALANCES; vehicles → canAny(MANAGE_VEHICLES, ADD_FUEL); profitability → VIEW_PROFITABILITY |
| /search | any authenticated user; results server-side involvement-scoped |
| /admin/users, /admin/users/[id] | MANAGE_USERS (permissions editor sub-gated on MANAGE_PERMISSIONS) |
| /admin/audit-log | VIEW_AUDIT_LOG |
| /settings | MANAGE_SETTINGS |

## API / server-action architecture

**Pattern:** Every mutation is a Next.js Server Action (`"use server"` file, one function per operation), never a hand-rolled REST endpoint. Every action starts with `getCurrentUser()` then `can()`/`canAny()`/`requirePermission()` before touching the DB; all writes go through Drizzle inside `db.transaction(...)`; every sensitive action ends with a `recordAudit(...)` call inside the same transaction. Custom Route Handlers exist only for the 6 cases a Server Action can't serve (file downloads, external calendar payload, a public token-signed PDF).

**30 "use server" files, ~75 exported actions**, grouped by domain:

| File | Exported actions |
|---|---|
| `jobs/actions.ts` | createJob, createMeasurement, addJobItem, deleteJobItem, assignToJob, removeAssignment, cancelJob |
| `jobs/close.ts` | closeJobAction |
| `appointments/actions.ts` | scheduleAppointmentAction, cancelAppointmentAction, markAppointmentArrivedAction, addFieldNoteAction |
| `appointments/complete-installation.ts` | completeInstallationAction |
| `payments/actions.ts` | addPaymentAction |
| `approvals/actions.ts` + `approvals/decide.ts` | decideCustomerPaymentAction |
| `costs/actions.ts` | addJobCostAction, decideJobCostAction |
| `production/actions.ts` | sendToFactoryAction, submitFactoryPriceAction *(public)* |
| `production/approve.ts` | approveFactorySubmission, rejectFactorySubmission |
| `quotes/actions.ts` | saveQuoteDraft, sendQuoteAction, convertQuoteToJob, signQuotePublicly *(public)* |
| `quotes/ai-draft-actions.ts` | generateQuoteDraftAction |
| `measurements/actions.ts` | submitFieldMeasurementAction |
| `repairs/actions.ts` | createRepairAction, updateRepairStatusAction |
| `compensation/actions.ts` | allocateInstallationEarning, recordDailyWage, recordVehicleUsageDeduction, recordBonus, recordPenalty, reportTechnicianPayment, decideTechnicianLedgerEntry |
| `compensation/commission.ts` | estimateCommission, finalizeCommission |
| `finance/expense-actions.ts` | reportFieldExpenseAction, decideFieldExpenseAction |
| `finance/transfer-actions.ts` | createCashTransfer, confirmCashTransfer |
| `customers/actions.ts` | searchCustomersAction, createCustomer, updateCustomer |
| `users/actions.ts` | createUserAction, updateUserAction, setUserStatusAction, resetUserPasswordAction, grantPermissionAction, revokePermissionAction |
| `lookups/actions.ts` | 10 CRUD actions (job status, work type, compensation/penalty/bonus rules) |
| `settings-actions.ts` | updateGeneralSettingsAction |
| `vehicles/actions.ts` | createVehicleAction, updateVehicleAction, assignVehicleResponsibility |
| `fuel/actions.ts` | addFuelAction |
| `checks/actions.ts` | createIncomingCheckAction, updateIncomingCheckStatusAction, createOutgoingCheckAction, updateOutgoingCheckStatusAction |
| `notifications-actions.ts` | markNotificationReadAction, markAllNotificationsReadAction |
| `(app)/actions.ts` | logoutAction |
| `(public)/login/actions.ts` | loginAction |
| `(app)/finance/job-search-action.ts` | searchJobsAction |

**6 Route Handlers:** `GET /api/appointments`, `GET /api/attachments/[id]`, `GET /api/notifications`, `GET /api/quotes/[quoteId]/pdf`, `GET /api/public/quotes/[token]/pdf`, `GET /api/reports/[report]`. All 5 authenticated ones live-verified to return 401 when unauthenticated; the public PDF route is token-gated.

## Test architecture

**Unit (vitest, `src/**/*.test.ts`, 8 files / 127 tests total — confirmed by two independent live runs in this audit cycle: a domain refuter's `npx vitest run`, and cross-checked against the total in prior sessions):**

| File | Covers |
|---|---|
| `src/server/auth/permissions.test.ts` (20 tests) | `can`/`canAny`/`requirePermission`/`requireAnyPermission`/`requireUser`, incl. the name/id non-branching assertion |
| `src/server/tokens.test.ts` (17 tests) | phone normalization/plausibility helpers (deliberately **not** covering `generateSecureToken`/`hashToken`) |
| `src/server/jobs/status.test.ts` (4 tests) | forward-only status-move guard |
| `src/server/money.test.ts` | decimal.js money primitives incl. float-trap regressions (0.1+0.2, 1.005, 30×0.10) |
| `src/server/reports/csv.test.ts` (20 tests) | CSV escaping (formula-injection guard), RFC4180 compliance |
| `src/server/storage/attachments.test.ts` (16 tests) | MIME allowlist (incl. SVG-stored-XSS regression), size/count limits |
| `src/lib/company-day.test.ts` (3 tests) | Asia/Jerusalem "today" boundary helper |
| `src/lib/location-links.test.ts` (14 tests) | tel:/Waze/Google-Maps URL builders |

**E2E (Playwright, `tests/e2e/*.spec.ts`, 8 spec files / 29 tests — this session's own live run):**

| Spec | Covers |
|---|---|
| `ahmad-scenario.spec.ts` (1 test) | Full worked scenario: fresh lead → measurement → quote → e-sign → auto-convert → auto-factory-route → factory approval → installation → cash handover → compensation → commission → repair → close, driven through real UI across 4 login contexts + 2 public-link contexts, with every total independently re-verified via SQL |
| `financial.spec.ts` (3 tests) | Payment approval/remaining recompute, technician balance from approved ledger only, cash-transfer confirm-before-move |
| `new-measurement.spec.ts` (7 tests) | Field quick-submit happy path, customer dedup-by-phone, dashboard visibility, attachment authz 200/403, job cancel, SVG/executable-MIME server-side rejection despite client bypass |
| `permissions.spec.ts` (7 tests) | DOM-absence gating (not just hidden), unauthorized financial-data access, job-visibility isolation |
| `production.spec.ts` (3 tests) | Tokenless factory submit→reject→resubmit→approve→booked job cost; decision-button absence without the right permission; non-factory job-cost approval |
| `quotes.spec.ts` (2 tests) | Signed-version immutability (byte-for-byte, incl. DB), public signing link + invalid/tampered token handling |
| `repairs.spec.ts` (2 tests) | Explicit repair status lifecycle (never automatic); closeJobAction gating on open repair → balance → success → stale double-close |
| `search.spec.ts` (4 tests) | Job/customer search by number/name/phone, short-query guard, zero-permission empty result, involvement-gated visibility |

**Acceptance scripts (not part of `npm test`/`npm run test:e2e`):** 13 `scripts/verify-*.mjs` files (login, phase4–10b, req-cash-installer, req3-quick-measurement, req4-ai-hebrew-quote, req5-auto-routing) — manual/ad-hoc harnesses, several of which cover ground the formal suites don't (e.g., 403-assertions against `/api/reports/*`).

## Toolchain results (exact numbers)

During synthesis, the dedicated toolchain harness's output directory had been wiped between the two halves of this audit run (a 5-day gap in the middle — see the run history note at the top of this document); lint/typecheck/build could not be confirmed at that moment. They were re-run immediately afterward, directly, against the same checkout:

| Check | Result |
|---|---|
| **Lint** (`npm run lint`) | **PASSED**, 0 errors, 0 warnings. Run 2026-09-14 14:04:12–14:04:29 IDT. |
| **Typecheck** (`npm run typecheck`) | **PASSED**, 0 errors. |
| **Unit tests (vitest)** | **127/127 passed, 0 failed**, 8 test files, 607ms. Independently confirmed twice more this cycle: once by a domain refuter's own live run, once by this direct re-run. |
| **E2E tests (Playwright)** | **29/29 passed, 0 failed.** Live run: `npx playwright test --reporter=list`, dev server already running at localhost:3000, `playwright.config.ts` has no `webServer` block (workers=1, fullyParallel=false, retries=0). Wall-clock 178s (2m58s). **Zero failing test names** — every one of the 29 tests listed in the Test Architecture table above passed. Seeded permission sets were confirmed fully restored to their exact pre-run state after the suite's revoke/restore test windows (set-equality re-verified live post-run for all 4 users). `git status --short` after the run showed only an unrelated untracked `.claude/` directory — no tracked/source file was modified by the test run. |
| **Build** (`npm run build`) | **PASSED** — production build completes cleanly, all 28 routes compiled. |

**Sprint 0 is toolchain-clean: lint, typecheck, all 127 unit tests, all 29 E2E tests, and the production build all pass with zero failures.**

## Requirement coverage counts

(Full row-by-row detail in `requirements-matrix.md`.)

| Status | R1.x/R2.x (64) | Master-prompt (117) | **Total (181)** |
|---|---:|---:|---:|
| IMPLEMENTED | 25 | 49 | **74 (41%)** |
| PARTIAL | 34 | 38 | **72 (40%)** |
| SECURITY ISSUE | 4 | 10 | **14 (8%)** |
| MISSING | 0 | 16 | **16 (9%)** |
| BROKEN | 1 | 2 | **3 (2%)** |
| SCHEMA ONLY | 0 | 2 | **2 (1%)** |

**Reconciliation applied:** 12 items were changed from a domain verifier's IMPLEMENTED verdict after a skeptic refuter re-verified and found a genuine gap (10 downgraded to PARTIAL, 2 **escalated** to SECURITY ISSUE/BROKEN: R1.32 /repairs company-wide leak, R1.10 ProductionSection price leak, D5 `.env.example` not tracked in git). 2 items (S1.7 rate limiting, R1.15 customer PII) were escalated to SECURITY ISSUE purely on live-probe evidence (unlimited login brute-force against a real account; live PII retrieval across job-involvement boundaries) that postdated the domain verifiers' own analysis. 1 item (R1.58, test suite passing) was refuted for a citation defect but restored to IMPLEMENTED given this session's own fresh, independently-reproducible E2E run.

## Exact remaining gaps, grouped under sprints S1–S10 of the master prompt

*(Only non-IMPLEMENTED items are listed. Each line: one gap, one sentence, closing the item IDs named. "S3" has no items in any of the 9 domain checklists supplied to this audit — nothing to report there.)*

**S1 — Security & Authorization** *(closes R1.5,7,14,41,48; P3,P4; I1,I5,I6; V1,V2; S1.1–S1.9; T1–T5; RG13,RG14)*
- No permission exists for sale-price visibility anywhere in the codebase, and it is rendered ungated on the job page, jobs list, customer page, and quote PDF to every involved viewer including installers. *(I6, P4, R1.41, S1.4, S1.5, T4, RG13)*
- `ProductionSection` on the job page renders the factory-submitted price with **no permission gate at all**, bypassing `VIEW_JOB_COSTS` the same way the sale-price leak bypasses it. *(R1.10)*
- `/customers` list and `/repairs` list have **no involvement/ownership scoping at all** — live-reproduced full-data leaks to a 7-permission installer account for both. *(S1.1, R1.32)*
- Job-scoped mutations (createMeasurement, scheduleAppointmentAction, cancelJob, closeJobAction, addPaymentAction, sendQuoteAction) check a permission key but never that the caller may see the job; `createMeasurement` additionally lets a restricted user self-grant job visibility. *(S1.2, R1.7)*
- 9+ child-entity actions (deleteJobItem, removeAssignment, cancelAppointmentAction, completeInstallationAction, approveFactorySubmission/rejectFactorySubmission, sendQuoteAction, convertQuoteToJob) trust a caller-supplied jobId with no ownership check, including two that corrupt cross-job financial data. *(S1.3)*
- No rate limiting exists anywhere — live-demonstrated as unlimited login brute-force against a real active account. *(S1.7, R1.48)*
- Factory public links never expire and neither link type can be manually revoked; quote-link revocation only happens implicitly on a new version. *(S1.8)*
- No test anywhere proves an installer cannot retrieve sale price/factory cost, even though they demonstrably can. *(S1.9)*
- No approval path anywhere checks requester ≠ decider; several flows auto-approve the requester's own submission silently, with no override/audit marker. *(V1, V2, S1.6, T3 pricing-revocation test gap)*
- `completeInstallationAction` has zero ownership/entity-scope/financial-permission checks — the single worst-scoped mutation in the codebase (see matrix §e CRITICAL #1).

**S2 — Quick Measurement Submission** *(closes R2.3; Q4,Q6; S2.2)*
- Glass type has no admin CRUD (settings-only seed data). *(Q4)*
- Submission "source" is not a persisted column — lost once the job advances past its initial status. *(Q6)*
- Reference-price + VAT-label display formatting has zero test coverage (the project's own design spec requires it). *(S2.2)*

**S4 — Quotes, Signing, AI, Commission** *(closes R1.20,21,52; R2.4,R2.5; P5; A1; G1,G4,G6,G7; C2,C3; S4.2,S4.3,S4.4; RG9(quote half),RG15)*
- Quote `notes` field is dead end-to-end (never collected, never persisted, never rendered in the PDF). *(R1.20, R1.52)*
- A signed quote's rendered item description is a live join to mutable `work_types.labelAr`, not a frozen snapshot — an unrelated settings edit silently changes what a customer's signed document displays. *(P5)*
- Signing-time address/GPS/phone/ID are captured but never applied to the job or shown to staff — dead data. *(R1.21, S4.2, G6)*
- Server-side signing only requires name+terms+signature; phone/ID/address are all optional despite being named "mandatory." *(R2.4, G1)*
- No stamp pad/upload exists for company customers. *(R2.4, G4)*
- AI prompt excludes attachments, structured job data, and the company's configured default terms. *(A1)*
- Both PDF routes render the *current* version, not the *signed* one — once a v2 is saved, the v1 signed PDF becomes unreachable. *(G7)*
- Commission estimates are manual-only (no auto-recompute) and are overwritten in place with no history, even after finalization. *(C2, C3)*
- Factory route content on signing is text-only (item summary + attachment count), never the actual files or structured specs. *(R2.5b, S4.3)*
- No installer job card is dispatched on signing at all — R2.5a is entirely unimplemented. *(R2.5a)*
- The PII-autofill cross-customer-leak regression fix has no dedicated regression test. *(RG15)*

**S5 — Dashboard, Notifications, Scheduler** *(closes R1.35,38,39,42,43,49,53; S5.1,S5.2,S5.4,S5.5,S5.6; RG11)*
- **No scheduler/worker exists anywhere in the stack** — self-documented gap, blocks 7 of 9 required notification triggers and all check-due reminders; explicitly a non-deferrable V1 requirement. *(S5.1, S5.2, S5.5, S5.6, RG11, R1.39, R1.53)*
- "Ready without install date" silently excludes jobs whose installation appointment was cancelled; "open repairs" scoping never checks `repairs.responsibleUserId`, so an assigned technician can't see their own repair on their own dashboard. *(R1.35)*
- Two cash-transfer notification types resolve to a route (`/finance/cash`) that does not exist — 404 on click. *(S5.4)*
- Audit log never records old/new values for quote price changes or job status transitions; no DB-level immutability guard. *(R1.38)*
- 3 of 4 notification-threshold settings and the default-quote-terms setting are dead controls the settings form itself falsely implies are active. *(R1.49)*
- No per-user filter exists on any report; customers report has no filters at all; jobs/customers reports expose sale price/balance behind VIEW_ALL_JOBS with no financial permission required. *(R1.42)*

**S6 — Customer & Job Page, Payment Status** *(closes R1.12,13,15,16,17,18,19,22,31,40,51; S6.1–S6.4,S6.6)*
- Customer detail page shows only 2 of 8 required sections (profile + jobs) and has **no job-involvement scoping**, live-confirmed to expose national ID PII across job boundaries. *(R1.15, S6.1, S6.4)*
- No payment-status label (Not/Partially/Fully Paid) is computed or displayed anywhere, despite all its inputs existing. *(R1.18, S6.2, S6.3)*
- 3 of 18 seeded job statuses are permanently unreachable by any live action; no edit path exists for measurements, job items, or appointments after creation. *(R1.17)*
- Item-level installer assignment and per-item "responsible" are schema-only, never wired to any UI/action. *(R1.22)*
- No create/edit UI exists for external contractors at all — only the seeded one exists. *(R1.31)*
- Global search omits address and quote-number, and its indexes can't serve the wildcard queries actually issued. *(R1.40)*
- Production requests are never numbered (dead `PR-` prefix constant, no column). *(R1.51)*
- The management cash/audit view has no per-Job, per-amount, or per-creator filter (creator is fetched but not even displayed). *(S6.6)*

**S7 — Contractors, Assignment, Vehicles, Production Links** *(closes R1.23–R1.30 area; F1,F2,F4,F5; S7.1–S7.6; RG8,RG9,RG10)*
- Factory approve/reject trust a caller-supplied jobId instead of the submission's real job, with no row lock — can book real costs on the wrong job and double-book under concurrency. *(R1.29, RG8's broader context)*
- Factory links never expire and cannot be revoked by staff at all. *(F5, S7.5, RG9, RG10)*
- Factory page never receives the actual attachment files — text mention only. *(F1, F2, F4)*
- Item-level installer assignment, contractor create/edit, and contractor assign-to-item are all unbuilt. *(S7.1, S7.2)*
- Overtime isn't even in the ledger-entry-type enum; fuel-reimbursement/other-adjustment have zero writer; every manager-recorded adjustment auto-approves with no routing. *(S7.3)*
- No vehicle-maintenance-cost feature exists at all (schema, action, and UI all absent). *(S7.6)*
- No manager-side action can record a company payout to a technician — only the worker's own self-report can. *(R1.24)*

**S8 — Installer / My Day UI** *(closes R1.28,32,33,34,36; R2.6; I2,I3,I4; S8.3; RG12)*
- No installer dispatch happens on signing at all; the only route to a restricted card is a manually-scheduled appointment, and the card links to the full priced job page. *(I2, I3, I4)*
- Installation-completion note is silently discarded unless a payment is also collected; the "photo taken" flag is unqueryable (audit-log JSON only). *(R1.33)*
- "Collect Payment" in My Day/completion has no COLLECT_PAYMENT check at all. *(R1.36, I4, S8.3)*
- No vehicle-maintenance tracking (duplicate of S7.6's own line, cross-referenced here for the vehicle-page consumer). *(R1.34)*
- Calendar leaks English FullCalendar built-in strings (locale module not imported); events show neither assignees nor location; no reschedule action exists. *(R1.28, RG12)*
- No standalone "جمع دفعة" action exists as a primary button. *(S8.3)*

**S9 — UI States, Localization, Errors** *(closes R1.9,10,11,44,45,50; R2.2; S9.1,S9.3)*
- **No `loading.tsx` exists anywhere in the app** — zero route-level loading state, including on the 17-query Job Details page. *(S9.1)*
- **No `not-found.tsx`/`error.tsx`/`global-error.tsx` exists anywhere** — a stale/mistyped job/customer/vehicle/user link (routine in a WhatsApp/SMS-shared field-service app) drops the user into Next's unstyled, **English** default 404 inside an otherwise 100%-Arabic-RTL product; live-reproduced. *(S9.3)*
- 6 server modules stamp business dates in raw UTC instead of the company's Asia/Jerusalem day the codebase itself has a tested helper for — a reproducible, self-acknowledged-in-code defect near local midnight. *(R2.2)*
- ProductionSection's ungated factory-price render is also the reason R1.10 downgrades from its domain's original IMPLEMENTED call. *(R1.10)*

**S10 — Testing, Deploy, Docs, Seed** *(closes R1.1–4,46,47,54–58; P6; S10.2; RG1–RG6,RG15; D1–D10)*
- **`.env.example` is not committed to git at all** — a fresh clone cannot follow the README's own documented setup step 2 (`cp .env.example .env` fails immediately). *(D5)*
- 2 environment variables the app actually reads (`OLLAMA_TIMEOUT_MS`, `DATABASE_POOL_MAX`) are undocumented in whatever `.env.example` a developer reconstructs. *(R1.54, D8)*
- The `cash_expense_reports` (field-expense) feature has zero seed data and zero test coverage of any kind. *(R1.46, S10.2)*
- 8 server modules (`ai`, `audit`, `checks`, `dashboard`, `fuel`, `lookups`, `pdf`, `users`, `vehicles`) have no dedicated test coverage. *(S10.2)*
- Lint/typecheck/build results are unknown for this audit cycle — the toolchain harness never completed (see Toolchain Results above); re-run before declaring Sprint 0 toolchain-clean.

## Backlog of non-critical findings

*(LOW/COSMETIC items and MEDIUM items not urgent enough to block Sprint 0 acceptance; full text and file citations in `requirements-matrix.md` §e.)*

1. `X-Powered-By: Next.js` header disclosed on every response (no `poweredByHeader: false`).
2. `generateMetadata()` leaks the real job number / customer identifier into the browser tab title for entities the viewer is about to be shown Forbidden for.
3. Dashboard headline counters (customers/active-jobs/awaiting-approval) are company-wide even for restricted viewers, inconsistent with the file's own scoping rule for the lists directly below them.
4. Nav shows "المستخدمون والصلاحيات" to `MANAGE_PERMISSIONS`-only users who then hit Forbidden (they also need `MANAGE_USERS`).
5. Several `revalidatePath` calls target routes that don't exist (`/finance/cash`, `/finance/checks`, `/admin/permissions`, `/technicians/[id]` instead of `/finance/technicians/[id]`) — users may see stale data after those mutations.
6. Session rows are never pruned; IP is recorded from a spoofable `X-Forwarded-For` with no trusted-proxy config.
7. Duplicate-phone customer creation crashes with raw English Postgres errors in the office flows (only the field-measurement quick-submit path does find-or-reuse).
8. `/finance` shows every incoming/outgoing check to any `COLLECT_PAYMENT` holder, including installers, with no `MANAGE_CHECKS`-level gate on the data itself.
9. Cash drawers can be driven negative — no balance check before a transfer/expense debit.
10. A cleared incoming check never becomes a `customer_payment` row — check money can be double-entered or silently dropped from a customer's paid total.
11. Re-signing a revised quote wipes and re-creates all `job_items`, losing installed-status flags and item-linked cost/assignment attribution.
12. `commission.ts`'s unique-violation recovery reads the wrong error field (`err.code` instead of `err.cause.code`, unlike every sibling module) — its documented race-recovery path almost certainly never triggers.
13. Auto-generated factory-request text interpolates a raw English unit key instead of the localized label the manual path uses.
14. A stale, untracked git worktree (`.claude/worktrees/...`) sits in the working directory — harmless, never committed, but dead weight.
15. Global search's btree indexes cannot serve the leading-wildcard `ILIKE` queries actually issued (no `pg_trgm`/GIN index in any migration).
16. Both `requirements-checklist.md` and `sprint0-checklist.md` referenced by this task were absent from the scratchpad for 2 of the 9 domain agents — their item-ID mapping is well-evidenced but not independently cross-checked against the original source-of-truth text; confirm these files exist before the next synthesis cycle.
