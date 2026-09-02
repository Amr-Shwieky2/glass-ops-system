import {
  pgTable,
  uuid,
  text,
  timestamp,
  numeric,
  index,
} from "drizzle-orm/pg-core";
import { ledgerEntryTypeEnum, approvalStatusEnum, commissionStatusEnum } from "./enums";
import { jobs, jobItems } from "./jobs";
import { users } from "./auth";
import { compensationRules, penaltyRules, bonusRules } from "./lookups";

/**
 * THE technician ledger (section 28) — append-only, one row per event.
 * A technician's balance is always SUM(amount) over their rows with
 * approvalStatus='approved', never a mutable balance column (section 74).
 * Sign convention: earnings/bonuses/reimbursements are positive (increase
 * what the company owes the technician); penalties and payments the
 * company makes to the technician are negative (they reduce it). See
 * src/server/compensation/ledger.ts for the single place that enforces
 * this convention when inserting rows.
 */
export const technicianLedgerEntries = pgTable(
  "technician_ledger_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    entryType: ledgerEntryTypeEnum("entry_type").notNull(),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),

    // Populated only for entryType = 'installation_earning'.
    compensationRuleId: uuid("compensation_rule_id").references(
      () => compensationRules.id,
      { onDelete: "set null" },
    ),
    quantity: numeric("quantity", { precision: 10, scale: 2 }),
    rateUsed: numeric("rate_used", { precision: 12, scale: 2 }),

    // Populated only for entryType = 'penalty' / 'bonus' when a predefined
    // rule was used (left null for a fully custom amount).
    penaltyRuleId: uuid("penalty_rule_id").references(() => penaltyRules.id, {
      onDelete: "set null",
    }),
    bonusRuleId: uuid("bonus_rule_id").references(() => bonusRules.id, {
      onDelete: "set null",
    }),

    relatedJobId: uuid("related_job_id").references(() => jobs.id, {
      onDelete: "set null",
    }),
    relatedJobItemId: uuid("related_job_item_id").references(
      () => jobItems.id,
      { onDelete: "set null" },
    ),
    description: text("description"),

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
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("ledger_entries_user_idx").on(t.userId),
    index("ledger_entries_job_idx").on(t.relatedJobId),
    index("ledger_entries_status_idx").on(t.approvalStatus),
  ],
);

/**
 * Deal-closing commission detail (section 32). Kept separate from the
 * generic ledger because it needs its own estimated-vs-final tracking;
 * finalizing one inserts exactly one technicianLedgerEntries row
 * (entryType='commission') and records its id back here.
 */
export const commissions = pgTable("commissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  jobId: uuid("job_id")
    .notNull()
    .references(() => jobs.id, { onDelete: "cascade" }),
  closedByUserId: uuid("closed_by_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  ratePercent: numeric("rate_percent", { precision: 5, scale: 2 }).notNull(),
  estimatedGrossProfit: numeric("estimated_gross_profit", {
    precision: 12,
    scale: 2,
  }),
  estimatedAmount: numeric("estimated_amount", { precision: 12, scale: 2 }),
  finalGrossProfit: numeric("final_gross_profit", { precision: 12, scale: 2 }),
  finalAmount: numeric("final_amount", { precision: 12, scale: 2 }),
  status: commissionStatusEnum("status").notNull().default("estimated"),
  finalizedAt: timestamp("finalized_at", { withTimezone: true }),
  ledgerEntryId: uuid("ledger_entry_id").references(
    () => technicianLedgerEntries.id,
    { onDelete: "set null" },
  ),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
