"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/server/db/client";
import { jobs, jobStatuses, repairs } from "@/server/db/schema";
import { getCurrentUser } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { PERMISSIONS } from "@/server/auth/permission-keys";
import { recordAudit } from "@/server/audit";
import { advanceJobStatus } from "@/server/jobs/status";
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
 */
export async function closeJobAction(
  jobId: string,
  _prevState: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!can(user, PERMISSIONS.CLOSE_DEAL)) {
    return { error: "لا تملك صلاحية إغلاق المهام." };
  }

  const [job] = await db
    .select({
      id: jobs.id,
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

  await db.transaction(async (tx) => {
    await advanceJobStatus(tx, jobId, "completed");
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

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/jobs");
  return { success: true };
}
