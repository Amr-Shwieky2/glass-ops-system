"use server";

import { revalidatePath } from "next/cache";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/server/db/client";
import type { Database } from "@/server/db/client";
import { commissions, jobs, jobCosts } from "@/server/db/schema";
import { getCurrentUser } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { PERMISSIONS } from "@/server/auth/permission-keys";
import { recordAudit } from "@/server/audit";
import { getSetting } from "@/server/settings";
import { subtractMoney, multiplyMoney, sumMoney, type Money } from "@/server/money";
import { writeLedgerEntry } from "@/server/compensation/ledger";
import { assertJobVisible } from "@/server/jobs/access";

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
 * Computes and upserts (by jobId) a commissions row at status='estimated'.
 * Never writes a ledger entry — an estimate is not yet official money
 * owed, only finalizeCommission books that.
 *
 * Requires MANAGE_TECHNICIAN_PAYMENTS alone — VIEW_PROFITABILITY is
 * documented and treated everywhere else in this codebase as read-only
 * ("See revenue, cost and margin figures"), so it must not be sufficient
 * to write to the commissions table, matching finalizeCommission's own
 * (correct) gate below. The UI never renders the "تقدير العمولة" button
 * for a VIEW_PROFITABILITY-only user (see compensation-section.tsx, which
 * only mounts EstimateCommissionButton/FinalizeCommissionButton under
 * canManageTechnicianPayments), so this is a defense-in-depth tightening,
 * not a dead-button fix.
 *
 * commissions.jobId carries a unique constraint (drizzle/migrations), so
 * a genuinely concurrent estimate/estimate or estimate/finalize race on a
 * job with no prior row can throw 23505 on the insert below; caught and
 * retried as an update against the row the winner just created, rather
 * than surfacing a raw DB error.
 */
export async function estimateCommission(jobId: string): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!can(user, PERMISSIONS.MANAGE_TECHNICIAN_PAYMENTS)) {
    return { error: "لا تملك صلاحية تقدير العمولات." };
  }
  const visErr = await assertJobVisible(user, jobId);
  if (visErr) return { error: visErr };

  const computeResult = await computeCommission(jobId);
  if (isComputeError(computeResult)) return { error: computeResult.error };
  const computed = computeResult;

  async function upsertEstimate(existingId: string | undefined) {
    await db.transaction(async (tx) => {
      if (existingId) {
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
          .where(eq(commissions.id, existingId));
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
  }

  const [existing] = await db
    .select({ id: commissions.id })
    .from(commissions)
    .where(eq(commissions.jobId, jobId))
    .limit(1);

  if (existing) {
    await upsertEstimate(existing.id);
  } else {
    try {
      await upsertEstimate(undefined);
    } catch (err: unknown) {
      const code = (err as { code?: string } | null)?.code;
      if (code !== "23505") throw err;

      const [raced] = await db
        .select({ id: commissions.id })
        .from(commissions)
        .where(eq(commissions.jobId, jobId))
        .limit(1);
      if (!raced) throw err;

      await upsertEstimate(raced.id);
    }
  }

  revalidatePath(`/jobs/${jobId}`);
  return { success: true };
}

/**
 * Finalizes an EXISTING commissions row (`existingId`) inside `tx`,
 * race-safely: the UPDATE only affects a row still not 'finalized', and
 * its returned row count is the real guard — exactly the pattern
 * `confirmCashTransfer` (src/server/finance/transfer-actions.ts) and
 * `decideCustomerPaymentAction` (src/server/approvals/decide.ts) use.
 * Only when this UPDATE actually wins the race do we write the ledger
 * entry (entryType='commission') — never unconditionally — so two
 * concurrent finalize calls against the same row can never both book one.
 * Returns won=false (no writes performed) when it lost the race.
 */
async function finalizeExistingCommission(
  tx: Database,
  params: {
    existingId: string;
    jobId: string;
    computed: ComputedCommission;
    now: Date;
    userId: string;
  },
): Promise<{ won: boolean }> {
  const { existingId, jobId, computed, now, userId } = params;

  const [updated] = await tx
    .update(commissions)
    .set({
      closedByUserId: computed.closedByUserId,
      ratePercent: String(computed.ratePercent),
      finalGrossProfit: computed.grossProfit,
      finalAmount: computed.amount,
      status: "finalized",
      finalizedAt: now,
    })
    .where(and(eq(commissions.id, existingId), ne(commissions.status, "finalized")))
    .returning({ id: commissions.id });

  if (!updated) return { won: false };

  const { id: ledgerEntryId } = await writeLedgerEntry(tx, {
    userId: computed.closedByUserId,
    entryType: "commission",
    amount: computed.amount,
    relatedJobId: jobId,
    description: `عمولة إغلاق صفقة — ${computed.ratePercent}% من الربح الإجمالي`,
    createdByUserId: userId,
    approvalStatus: "approved",
    approvedByUserId: userId,
  });

  await tx.update(commissions).set({ ledgerEntryId }).where(eq(commissions.id, existingId));

  await recordAudit(
    {
      userId,
      action: "commission.finalize",
      entityType: "commission",
      entityId: jobId,
      newValue: { ...computed, ledgerEntryId },
    },
    tx,
  );

  return { won: true };
}

/**
 * Recomputes against CURRENT job costs and locks in the final commission
 * (deliberate, explicit — per spec, never automatic; "prefer not to
 * finalize commission until sufficient actual job costs are known"). In
 * the same transaction, books exactly one technicianLedgerEntries row
 * (entryType='commission') and stores its id back onto the commissions
 * row. Works whether or not estimateCommission was ever called first.
 *
 * Race-safe against double-finalize (double-click, retry, two tabs) even
 * though commissions.jobId has no application-level "current status"
 * cached anywhere else to gate on:
 *  - If a commissions row already exists, finalizeExistingCommission does
 *    a conditional UPDATE ... WHERE status != 'finalized' and only writes
 *    the ledger entry if that UPDATE actually affected a row.
 *  - If no row exists yet, the INSERT itself (status already 'finalized')
 *    is the atomic claim: commissions.job_id carries a unique constraint
 *    (drizzle/migrations), so a concurrent second insert throws 23505.
 *    That is caught specifically and treated as "someone else's call
 *    created the row first" — re-read the real row and finish against it
 *    via the same finalizeExistingCommission path (handles both a
 *    concurrent finalize, which correctly reports "already finalized",
 *    and a concurrent estimateCommission, which correctly still finalizes
 *    it) rather than surfacing a generic/opaque DB error.
 */
export async function finalizeCommission(jobId: string): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!can(user, PERMISSIONS.MANAGE_TECHNICIAN_PAYMENTS)) {
    return { error: "لا تملك صلاحية اعتماد العمولات." };
  }
  const visErr = await assertJobVisible(user, jobId);
  if (visErr) return { error: visErr };

  const computed = await computeCommission(jobId);
  if (isComputeError(computed)) return { error: computed.error };

  const now = new Date();
  const userId = user!.id;
  let alreadyFinalized = false;

  // Fast-fail path for the common case — not the real guard, same
  // convention as every sibling decide/confirm action in this phase.
  const [existing] = await db
    .select({ id: commissions.id, status: commissions.status })
    .from(commissions)
    .where(eq(commissions.jobId, jobId))
    .limit(1);

  if (existing) {
    await db.transaction(async (tx) => {
      const { won } = await finalizeExistingCommission(tx, {
        existingId: existing.id,
        jobId,
        computed,
        now,
        userId,
      });
      if (!won) alreadyFinalized = true;
    });
  } else {
    try {
      await db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(commissions)
          .values({
            jobId,
            closedByUserId: computed.closedByUserId,
            ratePercent: String(computed.ratePercent),
            finalGrossProfit: computed.grossProfit,
            finalAmount: computed.amount,
            status: "finalized",
            finalizedAt: now,
          })
          .returning({ id: commissions.id });

        const { id: ledgerEntryId } = await writeLedgerEntry(tx, {
          userId: computed.closedByUserId,
          entryType: "commission",
          amount: computed.amount,
          relatedJobId: jobId,
          description: `عمولة إغلاق صفقة — ${computed.ratePercent}% من الربح الإجمالي`,
          createdByUserId: userId,
          approvalStatus: "approved",
          approvedByUserId: userId,
        });

        await tx
          .update(commissions)
          .set({ ledgerEntryId })
          .where(eq(commissions.id, inserted.id));

        await recordAudit(
          {
            userId,
            action: "commission.finalize",
            entityType: "commission",
            entityId: jobId,
            newValue: { ...computed, ledgerEntryId },
          },
          tx,
        );
      });
    } catch (err: unknown) {
      const code = (err as { code?: string } | null)?.code;
      if (code !== "23505") throw err;

      // Lost the insert race — a concurrent finalize or estimateCommission
      // call created the row first. Re-read the real current state and
      // finish (or correctly no-op) against THAT row instead of erroring.
      const [raced] = await db
        .select({ id: commissions.id, status: commissions.status })
        .from(commissions)
        .where(eq(commissions.jobId, jobId))
        .limit(1);
      if (!raced) throw err;

      await db.transaction(async (tx) => {
        const { won } = await finalizeExistingCommission(tx, {
          existingId: raced.id,
          jobId,
          computed,
          now,
          userId,
        });
        if (!won) alreadyFinalized = true;
      });
    }
  }

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
