/**
 * Fixed, code-branches-on-these enums.
 *
 * Anything the business might want to relabel, reorder, add to, or retire
 * WITHOUT a code change lives in a lookup table instead (see lookups.ts:
 * jobStatuses, workTypes, compensationRules, penaltyRules, bonusRules).
 * These enums are only for states application logic actually branches on.
 */
import { pgEnum } from "drizzle-orm/pg-core";

export const userStatusEnum = pgEnum("user_status", ["active", "suspended"]);

export const approvalStatusEnum = pgEnum("approval_status", [
  "pending",
  "approved",
  "rejected",
]);

export const paymentMethodEnum = pgEnum("payment_method", [
  "cash",
  "bank_transfer",
  "check",
  "other",
]);

export const incomingCheckStatusEnum = pgEnum("incoming_check_status", [
  "future",
  "due_soon",
  "deposited",
  "cleared",
  "failed",
  "cancelled",
]);

export const outgoingCheckStatusEnum = pgEnum("outgoing_check_status", [
  "pending",
  "issued",
  "cleared",
  "failed",
  "cancelled",
]);

export const repairStatusEnum = pgEnum("repair_status", [
  "open",
  "scheduled",
  "in_progress",
  "resolved",
]);

export const appointmentTypeEnum = pgEnum("appointment_type", [
  "measurement",
  "installation",
  "repair",
  "customer_meeting",
  "other",
]);

// Application-level progression is scheduled -> arrived -> completed, with
// cancelled a separate terminal branch reachable from either scheduled or
// arrived. pgEnum values carry no inherent order beyond declaration, but
// this declaration order mirrors that progression for readability.
export const appointmentStatusEnum = pgEnum("appointment_status", [
  "scheduled",
  "arrived",
  "completed",
  "cancelled",
]);

export const jobItemStatusEnum = pgEnum("job_item_status", [
  "pending",
  "in_production",
  "ready",
  "installed",
  "cancelled",
]);

export const factoryStatusEnum = pgEnum("factory_status", [
  "pending",
  "submitted",
  "approved",
  "rejected",
]);

export const jobCostCategoryEnum = pgEnum("job_cost_category", [
  "factory_glass",
  "hardware",
  "installer_labor",
  "daily_worker_labor",
  "external_contractor",
  "aluminum_contractor",
  "fuel",
  "other",
]);

export const ledgerEntryTypeEnum = pgEnum("ledger_entry_type", [
  "installation_earning",
  "daily_wage",
  "bonus",
  "penalty",
  "commission",
  "fuel_reimbursement",
  "vehicle_usage_deduction",
  "payment_made",
  "other_adjustment",
]);

export const cashAccountOwnerTypeEnum = pgEnum("cash_account_owner_type", [
  "user",
  "company",
]);

export const cashDirectionEnum = pgEnum("cash_direction", ["in", "out"]);

export const fuelTypeEnum = pgEnum("fuel_type", [
  "petrol",
  "diesel",
  "electric",
  "hybrid",
  "other",
]);

export const commissionStatusEnum = pgEnum("commission_status", [
  "estimated",
  "finalized",
]);

export const quoteStatusEnum = pgEnum("quote_status", [
  "draft",
  "sent",
  "signed",
  "expired",
  "superseded",
]);

/** Language the quote document (PDF + public signing page) is presented in.
 * Independent of the internal app UI, which stays Arabic/RTL throughout —
 * see AGENTS.md. Defaults to "ar"; "he" is for the Hebrew signing-flow
 * support built alongside this. */
export const quoteLanguageEnum = pgEnum("quote_language", ["ar", "he"]);

/**
 * The kind of record an approval_request / audit_log entry points at.
 * Kept as a plain enum (rather than a lookup table) because the set of
 * approvable/auditable entity types is a code-level concern: each value
 * must correspond to an actual table with actual approve/reject handling.
 */
export const approvableEntityTypeEnum = pgEnum("approvable_entity_type", [
  "customer_payment",
  "technician_ledger_entry",
  "factory_submission",
  "job_cost",
  "cash_expense_report",
]);
