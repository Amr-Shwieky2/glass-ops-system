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
    actingUserCanApprove: boolean;
  },
): Promise<{ paymentId: string; autoApproved: boolean }> {
  const autoApproved = params.actingUserCanApprove;
  const now = new Date();

  const [payment] = await tx
    .insert(customerPayments)
    .values({
      customerId: params.customerId,
      jobId: params.jobId,
      amount: params.amount,
      paymentDate: now.toISOString().slice(0, 10),
      method: params.method,
      receivedByUserId: params.receivedByUserId,
      notes: params.notes,
      approvalStatus: autoApproved ? "approved" : "pending",
      createdByUserId: autoApproved ? params.actingUserId : undefined,
      approvedByUserId: autoApproved ? params.actingUserId : undefined,
      approvedAt: autoApproved ? now : undefined,
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
      },
    },
    tx,
  );

  return { paymentId: payment.id, autoApproved };
}
