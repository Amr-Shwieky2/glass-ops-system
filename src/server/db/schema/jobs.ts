import {
  pgTable,
  uuid,
  text,
  timestamp,
  numeric,
  boolean,
  index,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { jobItemStatusEnum } from "./enums";
import { customers } from "./customers";
import { jobStatuses, workTypes } from "./lookups";
import { users } from "./auth";
import { externalContractors } from "./contractors";
import { quotes, quoteVersions } from "./quotes";

/**
 * The central object almost everything else hangs off (section 5). A Job
 * is created as soon as a lead comes in (status = new_lead) and lives for
 * the whole lifecycle — measurement, quoting, production, installation,
 * payment, repair — through to completed/cancelled. Nothing "converts"
 * into a Job later; "Convert Quote to Job" (section 20) means populating
 * this same row's items/price from the signed quote, not creating a new
 * entity, so data is never duplicated between stages.
 *
 * NOTE: salePriceTotal and everything payment-related is NEVER read as a
 * mutable balance here — remaining balance/payment status are computed
 * from customerPayments transactions on every read (src/server/jobs/money.ts).
 */
export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobNumber: text("job_number").notNull().unique(), // JOB-2026-0001
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    statusId: uuid("status_id")
      .notNull()
      .references(() => jobStatuses.id, { onDelete: "restrict" }),
    title: text("title"),
    address: text("address"), // overrides customer address if set
    latitude: numeric("latitude", { precision: 10, scale: 7 }),
    longitude: numeric("longitude", { precision: 10, scale: 7 }),

    // Commercial responsibility — three independent fields (section 16).
    measuredByUserId: uuid("measured_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    pricingResponsibleUserId: uuid("pricing_responsible_user_id").references(
      () => users.id,
      { onDelete: "set null" },
    ),
    dealClosedByUserId: uuid("deal_closed_by_user_id").references(
      () => users.id,
      { onDelete: "set null" },
    ),

    // Populated once a quote is signed / converted (section 20).
    salePriceTotal: numeric("sale_price_total", { precision: 12, scale: 2 }),
    quoteId: uuid("quote_id").references(
      (): AnyPgColumn => quotes.id,
      { onDelete: "set null" },
    ),
    sourceQuoteVersionId: uuid("source_quote_version_id").references(
      (): AnyPgColumn => quoteVersions.id,
      { onDelete: "set null" },
    ),

    notes: text("notes"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("jobs_customer_idx").on(t.customerId),
    index("jobs_status_idx").on(t.statusId),
    index("jobs_job_number_idx").on(t.jobNumber),
  ],
);

/** Line items of work within a Job (section 21). */
export const jobItems = pgTable(
  "job_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    workTypeId: uuid("work_type_id").references(() => workTypes.id, {
      onDelete: "set null",
    }),
    description: text("description"),
    quantity: numeric("quantity", { precision: 10, scale: 2 })
      .notNull()
      .default("1"),
    unit: text("unit"),
    salePrice: numeric("sale_price", { precision: 12, scale: 2 }),
    expectedCost: numeric("expected_cost", { precision: 12, scale: 2 }),
    status: jobItemStatusEnum("status").notNull().default("pending"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("job_items_job_idx").on(t.jobId)],
);

/**
 * Who is installing what (section 22/23) — at Job level (jobItemId null)
 * or a specific Job Item. Exactly one of userId / externalContractorId is
 * set (enforced in the service layer, see src/server/jobs/assignments.ts).
 * This is *assignment* only; compensation amounts live in
 * technicianLedgerEntries, allocated independently (section 25).
 */
export const jobAssignments = pgTable(
  "job_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    jobItemId: uuid("job_item_id").references(() => jobItems.id, {
      onDelete: "cascade",
    }),
    userId: uuid("user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    externalContractorId: uuid("external_contractor_id").references(
      () => externalContractors.id,
      { onDelete: "cascade" },
    ),
    role: text("role"), // e.g. 'installer' | 'helper'; free text, display only
    assignedAt: timestamp("assigned_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (t) => [
    index("job_assignments_job_idx").on(t.jobId),
    index("job_assignments_user_idx").on(t.userId),
  ],
);

/**
 * Measurement visit (section 15). measuredByUserId is who took it;
 * pricingResponsibleUserId is who the job gets handed to for pricing —
 * these are frequently different people and having Measurement permission
 * never implies Pricing permission.
 */
export const measurements = pgTable(
  "measurements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    measuredByUserId: uuid("measured_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    measuredAt: timestamp("measured_at", { withTimezone: true }).notNull(),
    details: text("details"),
    photosTaken: boolean("photos_taken").notNull().default(false),
    pricingResponsibleUserId: uuid("pricing_responsible_user_id").references(
      () => users.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("measurements_job_idx").on(t.jobId)],
);
