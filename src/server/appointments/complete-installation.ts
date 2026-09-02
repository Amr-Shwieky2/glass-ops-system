"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/server/db/client";
import { appointments, jobItems, jobs } from "@/server/db/schema";
import { getCurrentUser } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { PERMISSIONS } from "@/server/auth/permission-keys";
import { recordAudit } from "@/server/audit";
import { notifyUsers } from "@/server/notifications";
import { advanceJobStatus } from "@/server/jobs/status";
import { parseNonNegativeMoneyInput, isPositive } from "@/server/money";
import { recordCustomerPayment, getUserIdsWithPermission } from "@/server/payments/record";

export interface ActionState {
  error?: string;
  success?: boolean;
}

/**
 * The short "complete installation" flow (section 51/60), reached only
 * from My Day. Not a form-bound Server Action (no useActionState/formData)
 * — the dialog collects a checklist + two switches as plain client state
 * and calls this directly with typed params, the same "call it, await the
 * result, toast" shape as confirm-remove-button.tsx's onConfirm and
 * production/approve.ts's approve/rejectFactorySubmission.
 */
export async function completeInstallationAction(params: {
  appointmentId: string;
  jobItemIds: string[];
  photoTaken: boolean;
  paymentCollected: boolean;
  paymentAmount?: string;
  paymentMethod?: "cash" | "bank_transfer" | "check" | "other";
  note?: string;
}): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!can(user, PERMISSIONS.COMPLETE_INSTALLATION)) {
    return { error: "لا تملك صلاحية إكمال التركيب." };
  }

  const [appointment] = await db
    .select({ id: appointments.id, jobId: appointments.jobId, status: appointments.status })
    .from(appointments)
    .where(eq(appointments.id, params.appointmentId))
    .limit(1);
  if (!appointment) return { error: "الموعد غير موجود." };
  if (appointment.status !== "scheduled") {
    return { error: "تم التعامل مع هذا الموعد بالفعل." };
  }

  const [job] = await db
    .select({ id: jobs.id, customerId: jobs.customerId })
    .from(jobs)
    .where(eq(jobs.id, appointment.jobId))
    .limit(1);
  if (!job) return { error: "المهمة غير موجودة." };

  let paymentAmount: string | null = null;
  if (params.paymentCollected) {
    if (!params.paymentMethod) return { error: "طريقة الدفع مطلوبة." };
    paymentAmount = parseNonNegativeMoneyInput(params.paymentAmount);
    if (paymentAmount === null || !isPositive(paymentAmount)) {
      return { error: "مبلغ الدفعة غير صحيح." };
    }
  }

  let autoApprovedPayment = true;
  // Guards against a double-submit race: the UPDATE only affects an
  // appointment still 'scheduled', and its result tells us whether we
  // actually won that race — the plain SELECT above is just a fast-fail
  // for the common case, not the real guard. If we lost the race, skip
  // every other write in this transaction (job items, payment, job status,
  // audit) so nothing is double-recorded.
  let alreadyCompleted = false;
  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(appointments)
      .set({ status: "completed", updatedAt: new Date() })
      .where(
        and(eq(appointments.id, params.appointmentId), eq(appointments.status, "scheduled")),
      )
      .returning({ id: appointments.id });

    if (!updated) {
      alreadyCompleted = true;
      return;
    }

    if (params.jobItemIds.length > 0) {
      await tx
        .update(jobItems)
        .set({ status: "installed", updatedAt: new Date() })
        .where(inArray(jobItems.id, params.jobItemIds));
    }

    if (params.paymentCollected && paymentAmount) {
      const { autoApproved } = await recordCustomerPayment(tx, {
        jobId: job.id,
        customerId: job.customerId,
        amount: paymentAmount,
        method: params.paymentMethod!,
        receivedByUserId: user!.id,
        notes: params.note,
        actingUserId: user!.id,
        actingUserCanApprove: can(user, PERMISSIONS.APPROVE_PAYMENT),
      });
      autoApprovedPayment = autoApproved;
    }

    await advanceJobStatus(tx, job.id, "installed");

    await recordAudit(
      {
        userId: user!.id,
        action: "appointment.complete_installation",
        entityType: "job",
        entityId: job.id,
        newValue: {
          appointmentId: params.appointmentId,
          jobItemIds: params.jobItemIds,
          photoTaken: params.photoTaken,
          paymentCollected: params.paymentCollected,
          paymentAmount,
        },
      },
      tx,
    );
  });

  if (alreadyCompleted) {
    return { error: "تم التعامل مع هذا الموعد بالفعل." };
  }

  if (params.paymentCollected && !autoApprovedPayment) {
    const approverIds = await getUserIdsWithPermission(PERMISSIONS.APPROVE_PAYMENT);
    await notifyUsers(approverIds, {
      type: "customer_payment_pending_approval",
      title: "دفعة عميل بانتظار الاعتماد",
      relatedEntityType: "job",
      relatedEntityId: job.id,
    });
  }

  revalidatePath(`/jobs/${job.id}`);
  revalidatePath("/my-day");
  revalidatePath("/calendar");
  revalidatePath("/dashboard");

  return { success: true };
}
