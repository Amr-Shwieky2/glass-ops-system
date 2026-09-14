import "server-only";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { approvalRequests, customerPayments } from "@/server/db/schema";
import type { Database } from "@/server/db/client";
import { getCurrentUser } from "@/server/auth/session";
import { can, requesterMayApprove } from "@/server/auth/permissions";
import { PERMISSIONS } from "@/server/auth/permission-keys";
import { recordAudit } from "@/server/audit";
import { notifyUser } from "@/server/notifications";
import { creditCashAccount } from "@/server/finance/cash";

export interface ActionState {
  error?: string;
  success?: boolean;
}

/**
 * Adds one row to the reusable approval queue (section 61). Always takes a
 * transaction executor — it is only ever inserted alongside the entity it
 * approves being written as `approvalStatus/status: 'pending'`, in the
 * same transaction (see src/server/payments/record.ts).
 */
export async function createApprovalRequest(
  tx: Database,
  params: {
    entityType:
      | "customer_payment"
      | "technician_ledger_entry"
      | "factory_submission"
      | "job_cost"
      | "cash_expense_report";
    entityId: string;
    requestedByUserId: string;
    summary: string;
    // Nullable: e.g. a technician's self-reported payment (section 29) is
    // not tied to any one job.
    relatedJobId: string | null;
  },
): Promise<void> {
  await tx.insert(approvalRequests).values({
    entityType: params.entityType,
    entityId: params.entityId,
    requestedByUserId: params.requestedByUserId,
    summary: params.summary,
    relatedJobId: params.relatedJobId,
  });
}

function emptyToUndefined(value: FormDataEntryValue | null): string | undefined {
  const s = typeof value === "string" ? value.trim() : "";
  return s.length > 0 ? s : undefined;
}

const DecideCustomerPaymentSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  rejectionReason: z.string().trim().optional(),
});

/**
 * Decides a pending customer payment (section 33/61) — the ONE place that
 * flips customer_payments.approvalStatus, always in the same transaction
 * as the matching approval_requests row's decision (see the comment on
 * approvalRequests in schema/system.ts). Approving a cash payment also
 * credits the receiving employee's cash account in that same transaction.
 */
export async function decideCustomerPaymentAction(
  paymentId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  "use server";

  const user = await getCurrentUser();
  if (!can(user, PERMISSIONS.APPROVE_PAYMENT)) {
    return { error: "لا تملك صلاحية اعتماد الدفعات." };
  }

  const parsed = DecideCustomerPaymentSchema.safeParse({
    decision: formData.get("decision"),
    rejectionReason: emptyToUndefined(formData.get("rejectionReason")),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" };
  }

  const [payment] = await db
    .select()
    .from(customerPayments)
    .where(eq(customerPayments.id, paymentId))
    .limit(1);
  if (!payment) return { error: "الدفعة غير موجودة." };
  if (payment.approvalStatus !== "pending") {
    return { error: "تم اتخاذ قرار بشأن هذه الدفعة بالفعل." };
  }

  // Master prompt section 9: a requester cannot approve their own request.
  // "Requester" here is whoever created the payment record (falling back
  // to the receiving technician if it was recorded without a distinct
  // creator, same fallback the notification below already uses). Only a
  // super admin may override, and doing so must show up in the audit trail
  // — never a silent self-approval.
  const requesterId = payment.createdByUserId ?? payment.receivedByUserId;
  const selfApproval = requesterMayApprove(user, requesterId);
  if (!selfApproval.allowed) {
    return { error: "لا يمكنك اعتماد دفعة سجّلتها بنفسك." };
  }

  const [request] = await db
    .select()
    .from(approvalRequests)
    .where(
      and(
        eq(approvalRequests.entityType, "customer_payment"),
        eq(approvalRequests.entityId, paymentId),
        eq(approvalRequests.status, "pending"),
      ),
    )
    .limit(1);

  const approved = parsed.data.decision === "approve";
  const now = new Date();

  // Guards against a double-decide race (double-click, two approvers, a
  // retry): the UPDATE only affects a row still 'pending', and its result
  // tells us whether we actually won that race — the plain SELECT above is
  // just a fast-fail for the common case, not the real guard.
  let alreadyDecided = false;

  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(customerPayments)
      .set(
        approved
          ? { approvalStatus: "approved", approvedByUserId: user!.id, approvedAt: now }
          : { approvalStatus: "rejected" },
      )
      .where(
        and(
          eq(customerPayments.id, paymentId),
          eq(customerPayments.approvalStatus, "pending"),
        ),
      )
      .returning({ id: customerPayments.id });

    if (!updated) {
      alreadyDecided = true;
      return;
    }

    if (request) {
      await tx
        .update(approvalRequests)
        .set({
          status: approved ? "approved" : "rejected",
          decidedByUserId: user!.id,
          decidedAt: now,
          rejectionReason: approved ? null : parsed.data.rejectionReason,
        })
        .where(eq(approvalRequests.id, request.id));
    }

    await recordAudit(
      {
        userId: user!.id,
        action: "customer_payment.decide",
        entityType: "customer_payment",
        entityId: paymentId,
        newValue: {
          decision: parsed.data.decision,
          ...(selfApproval.isOverride ? { selfApprovalOverride: true } : {}),
        },
      },
      tx,
    );

    if (approved && payment.method === "cash") {
      await creditCashAccount(tx, {
        userId: payment.receivedByUserId,
        amount: payment.amount,
        sourceType: "customer_payment",
        sourceId: payment.id,
        createdByUserId: user!.id,
      });
    }
  });

  if (alreadyDecided) {
    return { error: "تم اتخاذ قرار بشأن هذه الدفعة بالفعل." };
  }

  await notifyUser({
    userId: payment.createdByUserId ?? payment.receivedByUserId,
    type: "customer_payment_decided",
    title: approved ? "تم اعتماد دفعة العميل" : "تم رفض دفعة العميل",
    relatedEntityType: "job",
    relatedEntityId: payment.jobId,
  });

  revalidatePath(`/jobs/${payment.jobId}`);
  return { success: true };
}
