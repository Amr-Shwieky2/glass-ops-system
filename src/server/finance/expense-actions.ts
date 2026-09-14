"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  cashExpenseReports,
  approvalRequests,
  users,
  userPermissions,
} from "@/server/db/schema";
import { getCurrentUser } from "@/server/auth/session";
import { can, requesterMayApprove } from "@/server/auth/permissions";
import { PERMISSIONS, type PermissionKey } from "@/server/auth/permission-keys";
import { recordAudit } from "@/server/audit";
import { notifyUsers, notifyUser } from "@/server/notifications";
import { parseNonNegativeMoneyInput, isPositive, formatILS } from "@/server/money";
import { getOrCreateCashAccountForUser, debitCashAccount } from "@/server/finance/cash";
import { createApprovalRequest } from "@/server/approvals/decide";

export interface ActionState {
  error?: string;
  success?: boolean;
}

function emptyToUndefined(value: FormDataEntryValue | null): string | undefined {
  const s = typeof value === "string" ? value.trim() : "";
  return s.length > 0 ? s : undefined;
}

/**
 * Active users holding a given permission — a small local duplicate of the
 * equivalent helper in src/server/payments/record.ts, kept here rather
 * than imported across modules (matches this codebase's established
 * low-coupling convention for this exact helper — see that file's own
 * comment, and its sibling copies in transfer-actions.ts, costs/actions.ts
 * and compensation/actions.ts).
 */
async function getUserIdsWithPermission(permissionKey: PermissionKey): Promise<string[]> {
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

const ReportFieldExpenseSchema = z.object({
  amount: z.string().trim().min(1, { error: "المبلغ مطلوب" }),
  description: z.string().trim().min(1, { error: "وصف المصروف مطلوب" }),
});

/**
 * A technician reports a field expense (fuel, tolls, materials bought
 * on-site, etc.) paid out of cash they are personally holding. Anyone who
 * holds COLLECT_PAYMENT may report — the same permission that lets someone
 * hold company cash in the first place (section 34) — and always against
 * THEIR OWN cash account, resolved server-side via
 * getOrCreateCashAccountForUser, never a formData field. Always queued as
 * 'pending': unlike reportTechnicianPayment (compensation/actions.ts),
 * there is no auto-approve-if-already-a-manager shortcut here, since this
 * report requests spending real company cash, not just acknowledging a
 * payment already made. Does NOT move any balance by itself — see the
 * comment on cashExpenseReports in schema/finance.ts — that only happens
 * once decideFieldExpenseAction approves it.
 */
export async function reportFieldExpenseAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "يجب تسجيل الدخول." };
  if (!can(user, PERMISSIONS.COLLECT_PAYMENT)) {
    return { error: "لا تملك صلاحية الإبلاغ عن مصروف ميداني." };
  }

  const parsed = ReportFieldExpenseSchema.safeParse({
    amount: formData.get("amount"),
    description: formData.get("description"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" };
  }

  const amount = parseNonNegativeMoneyInput(parsed.data.amount);
  if (amount === null || !isPositive(amount)) {
    return { error: "المبلغ غير صحيح." };
  }

  let reportId = "";
  await db.transaction(async (tx) => {
    const cashAccountId = await getOrCreateCashAccountForUser(tx, user.id);

    const [report] = await tx
      .insert(cashExpenseReports)
      .values({
        cashAccountId,
        amount,
        description: parsed.data.description,
        reportedByUserId: user.id,
      })
      .returning({ id: cashExpenseReports.id });
    reportId = report.id;

    await createApprovalRequest(tx, {
      entityType: "cash_expense_report",
      entityId: report.id,
      requestedByUserId: user.id,
      summary: `${user.name} أبلغ عن مصروف ميداني بمبلغ ${formatILS(amount)}`,
      relatedJobId: null,
    });

    await recordAudit(
      {
        userId: user.id,
        action: "cash_expense_report.create",
        entityType: "cash_expense_report",
        entityId: report.id,
        newValue: { cashAccountId, amount, description: parsed.data.description },
      },
      tx,
    );
  });

  const approverIds = await getUserIdsWithPermission(PERMISSIONS.MANAGE_TECHNICIAN_PAYMENTS);
  await notifyUsers(approverIds, {
    type: "cash_expense_report_pending_approval",
    title: `مصروف ميداني بمبلغ ${formatILS(amount)} بانتظار الاعتماد`,
    body: `أبلغ ${user.name} عن مصروف ميداني: ${parsed.data.description}`,
    relatedEntityType: "cash_expense_report",
    relatedEntityId: reportId,
  });

  revalidatePath(`/finance/technicians/${user.id}`);
  revalidatePath("/approvals");
  return { success: true };
}

const DecideFieldExpenseSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  rejectionReason: z.string().trim().optional(),
});

/**
 * Decides a pending field-expense report (section 34, unfulfilled-gap
 * fix) — the ONE place that flips cash_expense_reports.status, always in
 * the same transaction as the matching approval_requests row's decision.
 * Race-safe against a double-decide (double-click, two approvers, a
 * retry) exactly like decideCustomerPaymentAction / confirmCashTransfer /
 * decideTechnicianLedgerEntry / decideJobCostAction: the UPDATE only
 * affects a row still 'pending', and its returned row count is the real
 * guard — the plain SELECT above is just a fast-fail for the common case.
 * Approving posts the real cash_transactions 'out' row (sourceType=
 * 'field_expense') in that same transaction, via debitCashAccount.
 */
export async function decideFieldExpenseAction(
  reportId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!can(user, PERMISSIONS.MANAGE_TECHNICIAN_PAYMENTS)) {
    return { error: "لا تملك صلاحية اعتماد المصاريف الميدانية." };
  }

  const parsed = DecideFieldExpenseSchema.safeParse({
    decision: formData.get("decision"),
    rejectionReason: emptyToUndefined(formData.get("rejectionReason")),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" };
  }
  if (parsed.data.decision === "reject" && !parsed.data.rejectionReason) {
    return { error: "سبب الرفض مطلوب." };
  }

  const [report] = await db
    .select()
    .from(cashExpenseReports)
    .where(eq(cashExpenseReports.id, reportId))
    .limit(1);
  if (!report) return { error: "طلب المصروف غير موجود." };
  if (report.status !== "pending") {
    return { error: "تم اتخاذ قرار بشأن هذا الطلب بالفعل." };
  }

  const selfApproval = requesterMayApprove(user, report.reportedByUserId);
  if (!selfApproval.allowed) {
    return { error: "لا يمكنك اعتماد مصروفاً أبلغتَ عنه بنفسك." };
  }

  const [request] = await db
    .select()
    .from(approvalRequests)
    .where(
      and(
        eq(approvalRequests.entityType, "cash_expense_report"),
        eq(approvalRequests.entityId, reportId),
        eq(approvalRequests.status, "pending"),
      ),
    )
    .limit(1);

  const approved = parsed.data.decision === "approve";
  const now = new Date();

  // Guards against a double-decide race exactly like the other decide
  // actions in this codebase: the UPDATE only affects a row still
  // 'pending', and its result tells us whether we actually won that race —
  // the plain SELECT above is just a fast-fail for the common case, not
  // the real guard.
  let alreadyDecided = false;

  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(cashExpenseReports)
      .set(
        approved
          ? { status: "approved", decidedByUserId: user!.id, decidedAt: now }
          : {
              status: "rejected",
              decidedByUserId: user!.id,
              decidedAt: now,
              rejectionReason: parsed.data.rejectionReason,
            },
      )
      .where(and(eq(cashExpenseReports.id, reportId), eq(cashExpenseReports.status, "pending")))
      .returning({ id: cashExpenseReports.id });

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

    if (approved) {
      await debitCashAccount(tx, {
        cashAccountId: report.cashAccountId,
        amount: report.amount,
        sourceType: "field_expense",
        sourceId: report.id,
        notes: report.description,
        createdByUserId: user!.id,
      });
    }

    await recordAudit(
      {
        userId: user!.id,
        action: "cash_expense_report.decide",
        entityType: "cash_expense_report",
        entityId: reportId,
        newValue: {
          decision: parsed.data.decision,
          rejectionReason: parsed.data.rejectionReason,
          ...(selfApproval.isOverride ? { selfApprovalOverride: true } : {}),
        },
      },
      tx,
    );
  });

  if (alreadyDecided) {
    return { error: "تم اتخاذ قرار بشأن هذا الطلب بالفعل." };
  }

  await notifyUser({
    userId: report.reportedByUserId,
    type: "cash_expense_report_decided",
    title: approved ? "تم اعتماد المصروف الميداني" : "تم رفض المصروف الميداني",
    body: approved ? undefined : (parsed.data.rejectionReason ?? undefined),
    relatedEntityType: "cash_expense_report",
    relatedEntityId: reportId,
  });

  revalidatePath(`/finance/technicians/${report.reportedByUserId}`);
  revalidatePath("/approvals");
  return { success: true };
}
