"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { jobs, jobStatuses } from "@/server/db/schema";
import { getCurrentUser } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { PERMISSIONS } from "@/server/auth/permission-keys";
import { parseNonNegativeMoneyInput, isPositive } from "@/server/money";
import { recordCustomerPayment, getUserIdsWithPermission } from "@/server/payments/record";
import { notifyUsers } from "@/server/notifications";

export interface ActionState {
  error?: string;
  success?: boolean;
}

function emptyToUndefined(value: FormDataEntryValue | null): string | undefined {
  const s = typeof value === "string" ? value.trim() : "";
  return s.length > 0 ? s : undefined;
}

const AddPaymentSchema = z.object({
  amount: z.string().trim().min(1, { error: "المبلغ مطلوب" }),
  method: z.enum(["cash", "bank_transfer", "check", "other"]),
  notes: z.string().trim().optional(),
});

/**
 * Manual "add payment" action (section 33). Deliberately does NOT block on
 * the job being closed/cancelled — a final payment is often recorded right
 * when the job is being closed out, so terminal status is loaded but never
 * used as a rejection reason here.
 */
export async function addPaymentAction(
  jobId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!can(user, PERMISSIONS.COLLECT_PAYMENT)) {
    return { error: "لا تملك صلاحية تسجيل الدفعات." };
  }

  const parsed = AddPaymentSchema.safeParse({
    amount: formData.get("amount"),
    method: formData.get("method"),
    notes: emptyToUndefined(formData.get("notes")),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" };
  }

  const amount = parseNonNegativeMoneyInput(parsed.data.amount);
  if (amount === null || !isPositive(amount)) {
    return { error: "المبلغ غير صحيح" };
  }

  const [job] = await db
    .select({
      id: jobs.id,
      customerId: jobs.customerId,
      isTerminal: jobStatuses.isTerminal,
    })
    .from(jobs)
    .innerJoin(jobStatuses, eq(jobs.statusId, jobStatuses.id))
    .where(eq(jobs.id, jobId))
    .limit(1);
  if (!job) return { error: "المهمة غير موجودة" };

  const actingUserCanApprove = can(user, PERMISSIONS.APPROVE_PAYMENT);

  const { autoApproved } = await db.transaction((tx) =>
    recordCustomerPayment(tx, {
      jobId,
      customerId: job.customerId,
      amount,
      method: parsed.data.method,
      receivedByUserId: user!.id,
      notes: parsed.data.notes,
      actingUserId: user!.id,
      actingUserCanApprove,
    }),
  );

  if (!autoApproved) {
    const approverIds = await getUserIdsWithPermission(PERMISSIONS.APPROVE_PAYMENT);
    await notifyUsers(approverIds, {
      type: "customer_payment_pending_approval",
      title: "دفعة عميل بانتظار الاعتماد",
      relatedEntityType: "job",
      relatedEntityId: jobId,
    });
  }

  revalidatePath(`/jobs/${jobId}`);
  return { success: true };
}
