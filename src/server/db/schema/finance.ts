import {
  pgTable,
  uuid,
  text,
  timestamp,
  numeric,
  date,
  index,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import {
  jobCostCategoryEnum,
  approvalStatusEnum,
  paymentMethodEnum,
  cashAccountOwnerTypeEnum,
  cashDirectionEnum,
  incomingCheckStatusEnum,
  outgoingCheckStatusEnum,
} from "./enums";
import { jobs, jobItems } from "./jobs";
import { users } from "./auth";
import { customers } from "./customers";
import { externalContractors } from "./contractors";
import { technicianLedgerEntries } from "./compensation";

/**
 * Every Job cost is its own transaction row (section 46/74) — never a
 * mutable "total cost" field. Profitability sums only status='approved'
 * rows; a pending/rejected cost never counts (section 47/48).
 */
export const jobCosts = pgTable(
  "job_costs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    jobItemId: uuid("job_item_id").references(() => jobItems.id, {
      onDelete: "set null",
    }),
    category: jobCostCategoryEnum("category").notNull(),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    description: text("description"),
    vendorUserId: uuid("vendor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    externalContractorId: uuid("external_contractor_id").references(
      () => externalContractors.id,
      { onDelete: "set null" },
    ),
    // Set only for category = installer_labor / daily_worker_labor, when
    // this cost row was created together with a technician ledger entry
    // by the same service call (src/server/compensation/ledger.ts) so the
    // two can never be created or approved independently of each other.
    ledgerEntryId: uuid("ledger_entry_id").references(
      () => technicianLedgerEntries.id,
      { onDelete: "set null" },
    ),
    status: approvalStatusEnum("status").notNull().default("pending"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    approvedByUserId: uuid("approved_by_user_id").references(
      () => users.id,
      { onDelete: "set null" },
    ),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    incurredAt: date("incurred_at").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("job_costs_job_idx").on(t.jobId),
    index("job_costs_status_idx").on(t.status),
  ],
);

/**
 * Every customer payment is an independent transaction (section 33) — the
 * amount a customer has paid is always SUM(amount) of approved rows here,
 * never a field that gets overwritten.
 */
export const customerPayments = pgTable(
  "customer_payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "restrict" }),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    paymentDate: date("payment_date").notNull(),
    method: paymentMethodEnum("method").notNull(),
    receivedByUserId: uuid("received_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    notes: text("notes"),
    approvalStatus: approvalStatusEnum("approval_status")
      .notNull()
      .default("pending"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    approvedByUserId: uuid("approved_by_user_id").references(
      () => users.id,
      { onDelete: "set null" },
    ),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    // Sprint 6 (R1.27 fix): set only when this payment was auto-created by
    // an incoming check being marked 'cleared' (updateIncomingCheckStatusAction,
    // src/server/checks/actions.ts) — the money is now provably in hand, so
    // that transition creates the matching customer_payments row itself
    // rather than leaving check money invisible to (or double-enterable
    // against) the customer's paid total. UNIQUE so a check can never
    // spawn two payment rows even under a race — the write path checks
    // this first, but the constraint is the real, DB-level guarantee.
    sourceIncomingCheckId: uuid("source_incoming_check_id")
      .unique()
      .references((): AnyPgColumn => incomingChecks.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("customer_payments_job_idx").on(t.jobId),
    index("customer_payments_customer_idx").on(t.customerId),
  ],
);

/**
 * One row per person/company who can hold company cash (section 34), plus
 * one ownerType='company' row for the central account. Balance is NEVER
 * stored — always SUM(cashTransactions) for the account, see
 * src/server/finance/cash.ts.
 */
export const cashAccounts = pgTable("cash_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerType: cashAccountOwnerTypeEnum("owner_type").notNull(),
  ownerUserId: uuid("owner_user_id")
    .references(() => users.id, { onDelete: "restrict" })
    .unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Append-only ledger of cash moving in/out of an account. A customer cash
 * payment posts an 'in' row to the receiving employee's account; a
 * confirmed cash transfer posts a matching 'out'/'in' pair (see
 * cashTransfers below and src/server/finance/cash.ts).
 */
export const cashTransactions = pgTable(
  "cash_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cashAccountId: uuid("cash_account_id")
      .notNull()
      .references(() => cashAccounts.id, { onDelete: "restrict" }),
    direction: cashDirectionEnum("direction").notNull(),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    sourceType: text("source_type").notNull(), // 'customer_payment' | 'transfer' | 'adjustment'
    sourceId: uuid("source_id"), // polymorphic — points at customerPayments.id or cashTransfers.id
    notes: text("notes"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("cash_transactions_account_idx").on(t.cashAccountId)],
);

/**
 * Cash handover between two accounts (section 35), e.g. technician -> the
 * company. Confirming a transfer posts the two cashTransactions rows
 * atomically (src/server/finance/cash.ts) — this row alone does not move
 * any balance until confirmedAt is set.
 */
export const cashTransfers = pgTable("cash_transfers", {
  id: uuid("id").primaryKey().defaultRandom(),
  fromCashAccountId: uuid("from_cash_account_id")
    .notNull()
    .references(() => cashAccounts.id, { onDelete: "restrict" }),
  toCashAccountId: uuid("to_cash_account_id")
    .notNull()
    .references(() => cashAccounts.id, { onDelete: "restrict" }),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  transferredAt: timestamp("transferred_at", { withTimezone: true }).notNull(),
  notes: text("notes"),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  confirmedByUserId: uuid("confirmed_by_user_id").references(
    () => users.id,
    { onDelete: "set null" },
  ),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * A technician self-reporting a field expense (fuel, tolls, materials
 * bought on-site, etc.) paid out of cash they are personally holding —
 * the debit-side counterpart to cash_transfers' "hand cash back" flow.
 * Same "create pending, approve posts the real transaction" pattern as
 * cashTransfers/customerPayments/jobCosts: this row alone never moves any
 * balance — only decideFieldExpenseAction (src/server/finance/
 * expense-actions.ts), on approval, posts the matching direction='out'
 * cash_transactions row (sourceType='field_expense', sourceId=this row's
 * id) in the same transaction as the guarded status update.
 */
export const cashExpenseReports = pgTable(
  "cash_expense_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cashAccountId: uuid("cash_account_id")
      .notNull()
      .references(() => cashAccounts.id, { onDelete: "restrict" }),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    description: text("description").notNull(),
    reportedByUserId: uuid("reported_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    status: approvalStatusEnum("status").notNull().default("pending"),
    decidedByUserId: uuid("decided_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    rejectionReason: text("rejection_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("cash_expense_reports_account_idx").on(t.cashAccountId),
    index("cash_expense_reports_status_idx").on(t.status),
  ],
);

/** Checks received from customers (section 37). */
export const incomingChecks = pgTable(
  "incoming_checks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    checkNumber: text("check_number"),
    bank: text("bank"),
    dueDate: date("due_date").notNull(),
    receivedByUserId: uuid("received_by_user_id").references(
      () => users.id,
      { onDelete: "set null" },
    ),
    status: incomingCheckStatusEnum("status").notNull().default("future"),
    notes: text("notes"),
    statusUpdatedByUserId: uuid("status_updated_by_user_id").references(
      () => users.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("incoming_checks_due_date_idx").on(t.dueDate),
    index("incoming_checks_customer_idx").on(t.customerId),
  ],
);

/** Company-issued checks (section 38). */
export const outgoingChecks = pgTable(
  "outgoing_checks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    payeeName: text("payee_name").notNull(),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    checkNumber: text("check_number"),
    dueDate: date("due_date").notNull(),
    reason: text("reason"),
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
    status: outgoingCheckStatusEnum("status").notNull().default("pending"),
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
  },
  (t) => [index("outgoing_checks_due_date_idx").on(t.dueDate)],
);
