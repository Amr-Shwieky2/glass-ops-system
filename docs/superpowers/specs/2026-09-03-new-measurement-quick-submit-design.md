# New Measurement Quick-Submit — Design Spec

Status: Approved for implementation planning
Date: 2026-09-03

## 1. Context

This is the first of six pieces requested in a broader "Application Features
Update & Enhancements" ask. The full request bundled several independent
subsystems together (individual cash-drawer auditing, a full Arabic
localization sweep, this quick-submit flow, an AI-powered Hebrew quote
generator, automated post-signing routing, and installer UI simplification).
Per the brainstorming process, that request was decomposed into separate
sub-projects, each to be designed and built independently. This spec covers
**only** the "New Measurement" quick-submit flow (item #3 of the original
request). The other five items are out of scope here and will each get their
own design pass later.

Two items from the original request are explicitly **not** part of this
spec because they turned out to already exist in the system, confirmed
during design:

- Per-technician cash tracking (item #1) — already fully built
  (`cash_accounts`, `cash_transactions`, `/finance/technicians/:id`). Only a
  dedicated filtered audit view is still open, and that is its own,
  separate, much smaller sub-project.
- The general shape of "installer sees an abstracted job card" (item #6) —
  already built via My Day. Only the "arrived at site" concept is new, and
  belongs with that sub-project, not this one.

## 2. Goals

Let a technician in the field, with no prior office involvement, capture a
new inquiry in one short mobile form and have it land as a real, trackable
job the office can price — without asking the technician for anything the
office will need to redo, and without introducing a second, informal path to
a binding price.

## 3. Non-goals

- Not building a parallel "staging/inbox" system before a job is created
  (Approach A over Approach B, per the approved design).
- Not making the on-site price binding or feeding it into the formal Quote
  Builder automatically — it is reference information for whoever prices the
  job.
- Not building a Settings screen for upload limits (file size/count/type
  caps are fixed constants for this iteration).
- Not touching the existing office-initiated measurement flow
  (`AddMeasurementDialog` on the job detail page) — this is an additional,
  parallel entry point, not a replacement.
- Not part of this spec: cash-drawer audit view, Arabic sweep, AI quote
  generator, automated post-signing routing, "arrived at site" — each is a
  separate future sub-project.

## 4. Data model

### New table: `glass_types`

Admin-editable lookup, same shape and conventions as the existing
`work_types` table (see `src/server/db/schema/lookups.ts`):

```ts
export const glassTypes = pgTable("glass_types", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(),
  labelEn: text("label_en").notNull(),
  labelAr: text("label_ar").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
});
```

Seed with a starting set (tempered / laminated / frosted / mirrored /
patterned / other) — editable later via the Settings lookups CRUD already
built in Phase 10a (`src/server/lookups/actions.ts` already has the
create/update/deactivate pattern this table should follow; extend it rather
than duplicating it).

### New table: `measurement_attachments`

```ts
export const measurementAttachments = pgTable("measurement_attachments", {
  id: uuid("id").primaryKey().defaultRandom(),
  measurementId: uuid("measurement_id")
    .notNull()
    .references(() => measurements.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),        // original filename, for display
  storagePath: text("storage_path").notNull(),  // relative path on disk, never guessable
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  uploadedByUserId: uuid("uploaded_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (t) => [index("measurement_attachments_measurement_idx").on(t.measurementId)]);
```

### Changes to `measurements`

Add three nullable columns:

- `glassTypeId: uuid references glass_types (onDelete: set null)`
- `fieldQuotedPrice: numeric(12,2)` — nullable; a `Money` string when present,
  never touched by `money.ts` arithmetic beyond storage/display (it is not
  summed into anything).
- `fieldQuotedPriceIncludesVat: boolean` — nullable (meaningless unless
  `fieldQuotedPrice` is set). No VAT rate lookup or computation happens
  anywhere in this flow — the raw amount and the toggle's before/after
  state are simply stored and displayed as entered ("₪2,500 · شامل
  الضريبة"). Real VAT math, if any, happens later in the formal quote,
  which is out of scope here.

No changes needed to `jobs` — the new status (below) carries the
distinguishing signal.

### New `job_statuses` row

One new seeded status, `field_submission_pending` ("قياس من الميدان –
بانتظار المراجعة" / "Field Measurement — Pending Review"), inserted with a
`sortOrder` immediately after `measurement_completed` and before
`waiting_for_pricing`. `isTerminal: false`. This is a data-only addition (a
row in an existing table), not a schema change, and is safe under the
forward-only status guard already in `advanceJobStatus` — a job created
directly at this status can advance normally from here through the rest of
the existing pipeline (pricing → quote → production → installation →
payment → completion) with no changes to that pipeline's own logic.

Migration: one Drizzle migration adding the two new tables and the three new
`measurements` columns. The new status row is a seed-time insert, not a
migration-time one (matching how every other status was originally seeded).

## 5. File storage

Files are written to a directory outside `public/` — e.g.
`storage/measurement-attachments/<measurement-id>/<uuid>-<original-filename>`
— so nothing is reachable by guessing a URL. A new authenticated route
handler, `GET /api/attachments/:attachmentId`, resolves the attachment's
owning job, applies the same involvement/permission check the job detail
page itself uses (`VIEW_ALL_JOBS`, or `VIEW_ASSIGNED_JOBS` plus
involvement), and streams the file with its stored MIME type — the same
"authenticated route handler, not a static public file" pattern the
existing quote-PDF routes already use.

Accepted types: `image/*` and `application/pdf`. Fixed limits: 15 MB per
file, 5 files per submission — validated both client-side (fast feedback)
and server-side (authoritative; never trust the client limit alone).

Write ordering, to avoid a partial-failure state: validate all inputs first
(including per-file size/type checks) before writing anything; write files
to disk first, collecting their paths; then run the DB transaction (create/
reuse customer, create job, insert measurement, insert attachment rows
referencing the already-written file paths). If the DB transaction fails
after files were written, the orphaned files are harmless (unreferenced,
cleanable later) — the reverse ordering (DB first, files after) would risk a
measurement row pointing at files that don't exist, which is worse.

In `docker-compose.yml`, this directory gets its own named volume so uploads
survive a container rebuild, matching how the Postgres data volume already
persists.

## 6. Permissions

No new permission. Gated on the existing `PERMISSIONS.CREATE_MEASUREMENT` —
anyone who can record a measurement today (per current seed data: Amr,
Mohammad, Issam, Basel) can use this entry point too. Creating the customer
and job is a side effect of this one action, not a separately-gated
capability, matching the project's existing "minimum permission for the
field-facing role" philosophy (the same person who could always attach a
measurement to a job the office made can now originate that job too).

## 7. User flow

1. My Day gets a new "قياس جديد" button, in the same position/style as the
   existing "إضافة وقود" quick action from Phase 9 (`add-fuel-quick-action.tsx`
   is the direct precedent), visible only to `CREATE_MEASUREMENT` holders.
2. Opens a dedicated full-page mobile route (not a dialog — file pickers are
   awkward in a modal): fields are client phone (required, validated with
   the existing `isPlausiblePhone`), customer name (optional), glass type
   (select, from `glass_types`), file upload (1–5 images/PDF), notes
   (optional textarea, maps to `measurements.details`), and an optional
   on-site price with a "قبل الضريبة / شامل الضريبة" toggle.
3. On submit, one Server Action: look up an existing customer by the
   normalized phone number and reuse it if found (never create a duplicate
   customer for a repeat caller), otherwise create a new customer (name
   falls back to a placeholder like "عميل جديد" if left blank); create a job
   at `field_submission_pending`, numbered through the existing job-number
   sequence exactly like any other job; insert the measurement row
   (`measuredByUserId` = current user, `measuredAt` = now, `details`,
   `glassTypeId`, `fieldQuotedPrice`, `fieldQuotedPriceIncludesVat`); insert
   the attachment rows; `recordAudit`; notify everyone holding
   `PERMISSIONS.CREATE_PRICE` that a new field submission needs pricing.
   `pricingResponsibleUserId` is deliberately left unset at creation —
   unlike the office-initiated flow, no one has chosen a pricing owner yet,
   so this is a broadcast to everyone who could take it, not an assignment
   to one person. Whoever acts on it first sets themselves as responsible
   the same way the existing pricing UI already lets any `CREATE_PRICE`
   holder do today.
4. From that point it is an ordinary job. It appears in `/jobs` (filterable
   by its distinct status), on the job detail page with its measurement,
   glass type, attachments (viewable/downloadable inline), and reference
   price clearly labeled as "on-site reference — not a binding quote," and
   as one more row in the dashboard's existing Needs Attention panel
   (`src/server/dashboard/needs-attention.ts` gets one more small query
   following the exact shape of `getJobsWaitingForPricing`).
5. Cancelling a bogus submission uses the existing Cancel Job flow — no new
   rejection mechanism.

## 8. Error handling

- Invalid/missing phone: clear inline Arabic validation error, same
  component-level pattern used elsewhere in the app.
- A file exceeding the size/type limit: rejected per-file with a specific
  message naming which file and why, before any submission happens.
- Network/partial submission failure: the action either fully succeeds or
  returns a single clear error (no half-created job with no measurement, or
  vice versa) — enforced by the write-files-then-transact ordering above.
- Duplicate rapid double-submit (double-tap): the submit button disables
  itself on first click the same way every other form in the app already
  does (`SubmitButton` / `useFormStatus`); no server-side idempotency key is
  introduced for this — a genuine duplicate can be cancelled after the fact
  the normal way, and the risk profile here (an internal field tool, not a
  public payment form) doesn't justify more than that.

## 9. Testing plan

- Vitest: file validation (size/type acceptance and rejection), the
  reference-price display formatting (amount + before/after-VAT label, no
  computation involved per section 4), and phone-normalization/dedup logic
  for the find-or-create customer lookup.
- Playwright: a technician with only `CREATE_MEASUREMENT` submits a new
  field measurement with an attachment and a reference price end to end;
  confirm the resulting job/customer/measurement/attachment rows are correct
  in the database; confirm it appears in the Needs Attention panel and the
  jobs list at the new status; confirm a second submission with the same
  phone number reuses the existing customer rather than duplicating it;
  confirm the attachment is retrievable by an authorized viewer and rejected
  for an unauthorized one; confirm cancelling it behaves like cancelling any
  other job.
- Manual click-through on a real device/viewport width, given this is
  explicitly a mobile-first, field-use flow.

## 10. Open questions carried forward (not blocking this spec)

- Whether `glass_types` should eventually feed into `job_items`/pricing
  directly (e.g. a compensation or cost rule keyed by glass type) is
  explicitly out of scope here — this spec only stores it as descriptive
  data on the measurement.
- Whether the automated "route to installer / factory" behavior (original
  item #5) should eventually trigger off jobs originated this way is a
  question for that sub-project, once it's designed, not this one.
