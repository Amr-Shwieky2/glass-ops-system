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

export const appointmentStatusEnum = pgEnum("appointment_status", [
  "scheduled",
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
]);
