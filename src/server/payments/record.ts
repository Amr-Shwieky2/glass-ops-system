import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { customerPayments, users, userPermissions } from "@/server/db/schema";
import { db } from "@/server/db/client";
import type { Database } from "@/server/db/client";
import type { PermissionKey } from "@/server/auth/permission-keys";
import { recordAudit } from "@/server/audit";
import { formatILS, type Money } from "@/server/money";
import { creditCashAccount } from "@/server/finance/cash";
import { createApprovalRequest } from "@/server/approvals/decide";
import { getTodayDateString } from "@/lib/company-day";

function paymentMethodLabelAr(method: string): string {
  switch (method) {
    case "cash":
      return "نقدية";
    case "bank_transfer":
      return "تحويل بنكي";
    case "check":
      return "شيك";
    default:
      return "أخرى";
  }
}

/**
 * Active users holding a given permission — a small local duplicate of the
 * equivalent private helper in src/server/production/actions.ts, kept here
 * rather than exported across modules (matches this codebase's low-coupling
 * convention for that helper).
 */
export async function getUserIdsWithPermission(
  permissionKey: PermissionKey,
): Promise<string[]> {
  const rows = await db
    .select({ id: users.id })
    .from(userPermissions)
    .innerJoin(users, eq(userPermissions.userId, users.id))
    .where(
      and(
        eq(userPermissions.permissionKey, permissionKey),
        eq(users.status, "active"),
        isNull(users.deletedAt),
      ),
    );
  return rows.map((r) => r.id);
}

/**
 * The ONE place that inserts a customer_payments row (section 33) — used
 * both by the installation-completion flow and the manual "add payment"
 * action, so every payment is created the exact same way regardless of
 * caller. Always takes a transaction executor: the payment row, its
 * optional cash credit, and its optional approval request must all commit
 * or fail together.
 */
export async function recordCustomerPayment(
  tx: Database,
  params: {
    jobId: string;
    customerId: string;
    amount: Money;
    method: "cash" | "bank_transfer" | "check" | "other";
    receivedByUserId: string;
    notes?: string;
    actingUserId: string;
    /** Master prompt section 9: a requester cannot approve their own
     * request. Recording a payment and having it land already-approved
     * IS a self-approval shortcut, so this is true only for a super
     * admin's explicit override (see src/server/auth/permissions.ts
     * isSuperAdmin) — never merely "holds APPROVE_PAYMENT". Everyone
     * else's payment always lands pending, for a DIFFERENT
     * APPROVE_PAYMENT holder to decide. */
    actingUserIsSuperAdmin: boolean;
    /** Sprint 6 (R1.27 fix) — set ONLY by updateIncomingCheckStatusAction
     * (src/server/checks/actions.ts) when a check is marked 'cleared'.
     * This is NOT a self-report of "I personally collected money" (the
     * case the pending-by-default rule above guards against) — it is the
     * bank confirming the check cleared, which is why this payment lands
     * approved immediately regardless of who clicks the status change,
     * same as the super-admin override but for a structurally different
     * reason. Also stamps the FK so a check can never spawn two payment
     * rows (customerPayments.sourceIncomingCheckId is UNIQUE). */
    sourceIncomingCheckId?: string;
  },
): Promise<{ paymentId: string; autoApproved: boolean }> {
  const autoApproved = params.actingUserIsSuperAdmin || params.sourceIncomingCheckId !== undefined;
  const now = new Date();

  const [payment] = await tx
    .insert(customerPayments)
    .values({
      customerId: params.customerId,
      jobId: params.jobId,
      amount: params.amount,
      paymentDate: getTodayDateString(now),
      method: params.method,
      receivedByUserId: params.receivedByUserId,
      notes: params.notes,
      approvalStatus: autoApproved ? "approved" : "pending",
      // Always recorded, regardless of approval status — this is who
      // requested the payment be entered, and the self-approval check in
      // decideCustomerPaymentAction depends on knowing that reliably.
      createdByUserId: params.actingUserId,
      approvedByUserId: autoApproved ? params.actingUserId : undefined,
      approvedAt: autoApproved ? now : undefined,
      sourceIncomingCheckId: params.sourceIncomingCheckId,
    })
    .returning();

  if (autoApproved && params.method === "cash") {
    await creditCashAccount(tx, {
      userId: params.receivedByUserId,
      amount: params.amount,
      sourceType: "customer_payment",
      sourceId: payment.id,
      createdByUserId: params.actingUserId,
    });
  }

  if (!autoApproved) {
    await createApprovalRequest(tx, {
      entityType: "customer_payment",
      entityId: payment.id,
      requestedByUserId: params.actingUserId,
      summary: `دفعة ${paymentMethodLabelAr(params.method)} بمبلغ ${formatILS(params.amount)} من العميل`,
      relatedJobId: params.jobId,
    });
  }

  await recordAudit(
    {
      userId: params.actingUserId,
      action: "customer_payment.create",
      entityType: "customer_payment",
      entityId: payment.id,
      newValue: {
        jobId: params.jobId,
        amount: params.amount,
        method: params.method,
        autoApproved,
        ...(autoApproved ? { selfApprovalOverride: true } : {}),
      },
    },
    tx,
  );

  return { paymentId: payment.id, autoApproved };
}
