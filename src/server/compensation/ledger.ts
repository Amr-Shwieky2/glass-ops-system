import "server-only";
import { technicianLedgerEntries, jobCosts } from "@/server/db/schema";
import type { Database } from "@/server/db/client";
import type { Money } from "@/server/money";
import { getTodayDateString } from "@/lib/company-day";

/** Mirrors ledgerEntryTypeEnum in src/server/db/schema/enums.ts. */
export type LedgerEntryType =
  | "installation_earning"
  | "daily_wage"
  | "bonus"
  | "penalty"
  | "commission"
  | "fuel_reimbursement"
  | "vehicle_usage_deduction"
  | "payment_made"
  | "other_adjustment"
  | "overtime";

export type LaborCostCategory = "installer_labor" | "daily_worker_labor";

/**
 * THE ONE place that inserts a technician_ledger_entries row (section 28).
 * Every caller elsewhere in src/server/compensation/ goes through this
 * function so the sign convention (documented on the table itself) and the
 * approved/pending bookkeeping (approvedAt set only when actually approved)
 * can never drift between call sites. This function does NOT flip signs —
 * callers must already pass a negative `amount` for entryType
 * penalty/vehicle_usage_deduction/payment_made.
 *
 * Always takes a transaction executor: a ledger entry that pairs with a job
 * cost (see pairInstallerLaborCost below) must commit or fail together with
 * that job cost row.
 */
export async function writeLedgerEntry(
  tx: Database,
  params: {
    userId: string;
    entryType: LedgerEntryType;
    /** Already correctly signed by the caller — see the module doc above. */
    amount: Money;
    compensationRuleId?: string;
    quantity?: string;
    rateUsed?: Money;
    penaltyRuleId?: string;
    bonusRuleId?: string;
    relatedJobId?: string;
    relatedJobItemId?: string;
    description?: string;
    createdByUserId: string;
    approvalStatus: "approved" | "pending";
    approvedByUserId?: string;
  },
): Promise<{ id: string }> {
  const now = new Date();
  const approved = params.approvalStatus === "approved";

  const [row] = await tx
    .insert(technicianLedgerEntries)
    .values({
      userId: params.userId,
      entryType: params.entryType,
      amount: params.amount,
      compensationRuleId: params.compensationRuleId,
      quantity: params.quantity,
      rateUsed: params.rateUsed,
      penaltyRuleId: params.penaltyRuleId,
      bonusRuleId: params.bonusRuleId,
      relatedJobId: params.relatedJobId,
      relatedJobItemId: params.relatedJobItemId,
      description: params.description,
      approvalStatus: params.approvalStatus,
      createdByUserId: params.createdByUserId,
      approvedByUserId: params.approvedByUserId,
      approvedAt: approved ? now : undefined,
    })
    .returning({ id: technicianLedgerEntries.id });

  return { id: row.id };
}

/**
 * Inserts the job_costs row that pairs with an installation_earning or
 * daily_wage ledger entry (ARCHITECTURE.md section 5: installer
 * compensation is both money owed to a person AND a cost incurred by the
 * job, written by one service call in one transaction). `ledgerEntryId`
 * links the two rows together (job_costs.ledger_entry_id).
 *
 * `amount` here is always POSITIVE (a job cost is a positive expense) even
 * though the paired ledger entry is also positive (a positive earning) —
 * these are two independently-signed conventions for two different
 * tables; do not read one sign as implying the other.
 *
 * Only call this for entryType 'installation_earning' / 'daily_wage' —
 * other ledger entry types (bonus/penalty/commission/etc.) never create a
 * job cost.
 */
export async function pairInstallerLaborCost(
  tx: Database,
  params: {
    ledgerEntryId: string;
    /** The technician the cost/earning belongs to — stored as job_costs.vendor_user_id
     * (mirrors the seed data's installer_labor / daily_worker_labor rows). */
    userId: string;
    jobId: string;
    jobItemId?: string;
    category: LaborCostCategory;
    /** Positive — see the module doc above. */
    amount: Money;
    description: string;
    createdByUserId: string;
    approved: boolean;
  },
): Promise<void> {
  const now = new Date();

  await tx.insert(jobCosts).values({
    jobId: params.jobId,
    jobItemId: params.jobItemId,
    category: params.category,
    amount: params.amount,
    description: params.description,
    vendorUserId: params.userId,
    ledgerEntryId: params.ledgerEntryId,
    status: params.approved ? "approved" : "pending",
    createdByUserId: params.createdByUserId,
    approvedByUserId: params.approved ? params.createdByUserId : undefined,
    approvedAt: params.approved ? now : undefined,
    incurredAt: getTodayDateString(now),
  });
}
