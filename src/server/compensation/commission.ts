"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { commissions, jobs, jobCosts } from "@/server/db/schema";
import { getCurrentUser } from "@/server/auth/session";
import { can, canAny } from "@/server/auth/permissions";
import { PERMISSIONS } from "@/server/auth/permission-keys";
import { recordAudit } from "@/server/audit";
import { getSetting } from "@/server/settings";
import { subtractMoney, multiplyMoney, sumMoney, type Money } from "@/server/money";
import { writeLedgerEntry } from "@/server/compensation/ledger";

export interface ActionState {
  error?: string;
  success?: boolean;
}

/**
 * Sum of approved job_costs for one job. Local to this module — checked
 * src/server/jobs/queries.ts and the rest of the codebase first (per
 * AGENTS.md's instruction not to duplicate an existing helper); no
 * profitability/cost-sum helper exists anywhere else yet, so this is the
 * first one, kept private here rather than exported broadly.
 */
async function sumApprovedJobCosts(jobId: string): Promise<Money> {
  const rows = await db
    .select({ amount: jobCosts.amount })
    .from(jobCosts)
    .where(and(eq(jobCosts.jobId, jobId), eq(jobCosts.status, "approved")));
  return sumMoney(rows.map((r) => r.amount));
}

interface ComputedCommission {
  grossProfit: Money;
  amount: Money;
  ratePercent: number;
  closedByUserId: string;
}

type ComputeResult = ComputedCommission | { error: string };

function isComputeError(x: ComputeResult): x is { error: string } {
  return "error" in x;
}

/**
 * Shared compute step for both estimate and finalize — same formula
 * (grossProfit = salePriceTotal - approved job costs; amount = grossProfit
 * * rate%), evaluated against whatever job_costs exist at the moment it's
 * called. Handles a job with no defined margin safely (section 47): a
 * missing dealClosedByUserId or salePriceTotal returns an error instead of
 * dividing by / operating on null.
 */
async function computeCommission(jobId: string): Promise<ComputeResult> {
  const [job] = await db
    .select({
      id: jobs.id,
      dealClosedByUserId: jobs.dealClosedByUserId,
      salePriceTotal: jobs.salePriceTotal,
    })
    .from(jobs)
    .where(eq(jobs.id, jobId))
    .limit(1);
  if (!job) return { error: "المهمة غير موجودة." };
  if (!job.dealClosedByUserId) {
    return { error: "لا يمكن احتساب العمولة — لم يتم تحديد من أغلق الصفقة لهذه المهمة." };
  }
  if (!job.salePriceTotal) {
    return { error: "لا يمكن احتساب العمولة — لا يوجد سعر بيع محدد لهذه المهمة." };
  }

  const ratePercent = await getSetting("commission_rate_percent");
  const costs = await sumApprovedJobCosts(jobId);
  const grossProfit = subtractMoney(job.salePriceTotal, costs);
  const amount = multiplyMoney(grossProfit, ratePercent / 100);

  return { grossProfit, amount, ratePercent, closedByUserId: job.dealClosedByUserId };
}

/**
 * Computes and upserts (by jobId — the table has no DB unique constraint
 * on it, so this selects-then-inserts-or-updates itself) a commissions
 * row at status='estimated'. Never writes a ledger entry — an estimate is
 * not yet official money owed, only finalizeCommission books that.
 */
export async function estimateCommission(
  jobId: string,
  _prevState: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!canAny(user, [PERMISSIONS.MANAGE_TECHNICIAN_PAYMENTS, PERMISSIONS.VIEW_PROFITABILITY])) {
    return { error: "لا تملك صلاحية عرض الربحية." };
  }

  const computed = await computeCommission(jobId);
  if (isComputeError(computed)) return { error: computed.error };

  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: commissions.id })
      .from(commissions)
      .where(eq(commissions.jobId, jobId))
      .limit(1);

    if (existing) {
      // Only the estimated-side fields move here — a finalized commission's
      // final figures are never silently recomputed by a later estimate.
      await tx
        .update(commissions)
        .set({
          closedByUserId: computed.closedByUserId,
          ratePercent: String(computed.ratePercent),
          estimatedGrossProfit: computed.grossProfit,
          estimatedAmount: computed.amount,
        })
        .where(eq(commissions.id, existing.id));
    } else {
      await tx.insert(commissions).values({
        jobId,
        closedByUserId: computed.closedByUserId,
        ratePercent: String(computed.ratePercent),
        estimatedGrossProfit: computed.grossProfit,
        estimatedAmount: computed.amount,
        status: "estimated",
      });
    }

    await recordAudit(
      {
        userId: user!.id,
        action: "commission.estimate",
        entityType: "commission",
        entityId: jobId,
        newValue: computed,
      },
      tx,
    );
  });

  revalidatePath(`/jobs/${jobId}`);
  return { success: true };
}

/**
 * Recomputes against CURRENT job costs and locks in the final commission
 * (deliberate, explicit — per spec, never automatic; "prefer not to
 * finalize commission until sufficient actual job costs are known"). In
 * the same transaction, books exactly one technicianLedgerEntries row
 * (entryType='commission') and stores its id back onto the commissions
 * row. Works whether or not estimateCommission was ever called first.
 */
export async function finalizeCommission(
  jobId: string,
  _prevState: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!can(user, PERMISSIONS.MANAGE_TECHNICIAN_PAYMENTS)) {
    return { error: "لا تملك صلاحية اعتماد العمولات." };
  }

  const computed = await computeCommission(jobId);
  if (isComputeError(computed)) return { error: computed.error };

  const now = new Date();
  let alreadyFinalized = false;

  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: commissions.id, status: commissions.status })
      .from(commissions)
      .where(eq(commissions.jobId, jobId))
      .limit(1);

    // Guards against double-finalizing (spec: never write a second ledger
    // entry for an already-finalized commission).
    if (existing?.status === "finalized") {
      alreadyFinalized = true;
      return;
    }

    const { id: ledgerEntryId } = await writeLedgerEntry(tx, {
      userId: computed.closedByUserId,
      entryType: "commission",
      amount: computed.amount,
      relatedJobId: jobId,
      description: `عمولة إغلاق صفقة — ${computed.ratePercent}% من الربح الإجمالي`,
      createdByUserId: user!.id,
      approvalStatus: "approved",
      approvedByUserId: user!.id,
    });

    if (existing) {
      await tx
        .update(commissions)
        .set({
          closedByUserId: computed.closedByUserId,
          ratePercent: String(computed.ratePercent),
          finalGrossProfit: computed.grossProfit,
          finalAmount: computed.amount,
          status: "finalized",
          finalizedAt: now,
          ledgerEntryId,
        })
        .where(eq(commissions.id, existing.id));
    } else {
      await tx.insert(commissions).values({
        jobId,
        closedByUserId: computed.closedByUserId,
        ratePercent: String(computed.ratePercent),
        finalGrossProfit: computed.grossProfit,
        finalAmount: computed.amount,
        status: "finalized",
        finalizedAt: now,
        ledgerEntryId,
      });
    }

    await recordAudit(
      {
        userId: user!.id,
        action: "commission.finalize",
        entityType: "commission",
        entityId: jobId,
        newValue: { ...computed, ledgerEntryId },
      },
      tx,
    );
  });

  if (alreadyFinalized) {
    return { error: "تم اعتماد العمولة النهائية لهذه المهمة بالفعل." };
  }

  revalidatePath(`/jobs/${jobId}`);
  return { success: true };
}

export interface CommissionForJob {
  id: string;
  status: "estimated" | "finalized";
  ratePercent: Money;
  estimatedGrossProfit: Money | null;
  estimatedAmount: Money | null;
  finalGrossProfit: Money | null;
  finalAmount: Money | null;
  closedByUserId: string;
  finalizedAt: Date | null;
}

/** Current estimated/final commission figures for a job, for the Job
 * detail page — null when no commission has ever been computed for it. */
export async function getCommissionForJob(jobId: string): Promise<CommissionForJob | null> {
  const [row] = await db
    .select()
    .from(commissions)
    .where(eq(commissions.jobId, jobId))
    .limit(1);
  return row ?? null;
}
