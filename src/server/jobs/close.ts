"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/server/db/client";
import { jobs, jobStatuses, repairs } from "@/server/db/schema";
import { getCurrentUser } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { PERMISSIONS } from "@/server/auth/permission-keys";
import { recordAudit } from "@/server/audit";
import { getJobPayments } from "@/server/payments/queries";
import { compareMoney } from "@/server/money";

export interface ActionState {
  error?: string;
  success?: boolean;
}

/**
 * Closes a job — "a job can be closed after work and required payment
 * conditions are satisfied" (which explicitly includes "no open repair").
 * Gated the same as cancelJob (src/server/jobs/actions.ts): CLOSE_DEAL,
 * the one manual status transition exposed directly rather than a
 * free-form dropdown.
 *
 * Validates, in order, returning a clear error on the first failing check
 * and NOT proceeding:
 *   (a) the job isn't already terminal (mirrors the isTerminal check
 *       src/server/production/actions.ts's sendToFactoryAction uses)
 *   (b) no repair on this job is still open/scheduled/in_progress —
 *       queried directly here (not imported from
 *       src/server/repairs/queries.ts) to avoid a cross-stage file
 *       dependency during parallel development
 *   (c) the job's remaining balance is <= 0, against jobs.salePriceTotal
 *       via getJobPayments (src/server/payments/queries.ts, Phase 8) — a
 *       null salePriceTotal also blocks closing (a job can't be "fully
 *       paid" against an undefined price)
 *
 * All three checks above run as plain SELECTs before the transaction —
 * they're just a fast-fail for the common case. The actual guard against
 * a double-decide race (double-click, two admins, a retry) is the
 * conditional `UPDATE ... WHERE id = ? AND status_id = ?` below, pinned
 * to the exact status row observed above: if a concurrent close already
 * moved the job off that status, this UPDATE affects zero rows and we
 * report "already closed" instead of writing a second audit row (the
 * same pattern as src/server/approvals/decide.ts and
 * src/server/costs/actions.ts — advanceJobStatus()'s own SELECT-then-
 * UPDATE isn't race-safe on its own, so it's not used here).
 */
export async function closeJobAction(
  jobId: string,
  // Signature matches useActionState's (prevState, formData) call shape
  // (see src/app/(app)/jobs/[id]/close-job-button.tsx) even though this
  // action takes no form fields.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _prevState: ActionState,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _formData: FormData,
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!can(user, PERMISSIONS.CLOSE_DEAL)) {
    return { error: "لا تملك صلاحية إغلاق المهام." };
  }

  const [job] = await db
    .select({
      id: jobs.id,
      statusId: jobs.statusId,
      salePriceTotal: jobs.salePriceTotal,
      isTerminal: jobStatuses.isTerminal,
    })
    .from(jobs)
    .innerJoin(jobStatuses, eq(jobs.statusId, jobStatuses.id))
    .where(eq(jobs.id, jobId))
    .limit(1);
  if (!job) return { error: "المهمة غير موجودة" };
  if (job.isTerminal) return { error: "هذه المهمة مغلقة بالفعل." };

  const [openRepair] = await db
    .select({ id: repairs.id })
    .from(repairs)
    .where(
      and(
        eq(repairs.jobId, jobId),
        inArray(repairs.status, ["open", "scheduled", "in_progress"]),
      ),
    )
    .limit(1);
  if (openRepair) {
    return {
      error: "لا يمكن إغلاق المهمة قبل حل جميع طلبات الإصلاح المفتوحة عليها.",
    };
  }

  if (job.salePriceTotal === null) {
    return { error: "لا يمكن إغلاق المهمة قبل تحديد السعر الإجمالي لها." };
  }

  const { remaining } = await getJobPayments(jobId);
  if (remaining === null || compareMoney(remaining, "0.00") > 0) {
    return { error: "لا يمكن إغلاق المهمة قبل تحصيل كامل المبلغ المستحق." };
  }

  const [completedStatus] = await db
    .select({ id: jobStatuses.id })
    .from(jobStatuses)
    .where(eq(jobStatuses.key, "completed"))
    .limit(1);
  if (!completedStatus) return { error: "تعذر إغلاق المهمة." };

  let alreadyClosed = false;

  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(jobs)
      .set({ statusId: completedStatus.id, updatedAt: new Date() })
      .where(and(eq(jobs.id, jobId), eq(jobs.statusId, job.statusId)))
      .returning({ id: jobs.id });

    if (!updated) {
      alreadyClosed = true;
      return;
    }

    await recordAudit(
      {
        userId: user!.id,
        action: "job.close",
        entityType: "job",
        entityId: jobId,
        newValue: { salePriceTotal: job.salePriceTotal, remaining },
      },
      tx,
    );
  });

  if (alreadyClosed) {
    return { error: "هذه المهمة مغلقة بالفعل." };
  }

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/jobs");
  return { success: true };
}
