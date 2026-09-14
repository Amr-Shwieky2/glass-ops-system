"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/server/db/client";
import { jobCosts, approvalRequests, users, userPermissions } from "@/server/db/schema";
import { getCurrentUser } from "@/server/auth/session";
import { can, isSuperAdmin, requesterMayApprove } from "@/server/auth/permissions";
import { PERMISSIONS, type PermissionKey } from "@/server/auth/permission-keys";
import { recordAudit } from "@/server/audit";
import { notifyUsers, notifyUser } from "@/server/notifications";
import { parseNonNegativeMoneyInput, isPositive, formatILS } from "@/server/money";
import { createApprovalRequest } from "@/server/approvals/decide";
import { MANUAL_JOB_COST_CATEGORIES, type ManualJobCostCategory } from "@/server/costs/queries";

export interface ActionState {
  error?: string;
  success?: boolean;
}

function emptyToUndefined(value: FormDataEntryValue | null): string | undefined {
  const s = typeof value === "string" ? value.trim() : "";
  return s.length > 0 ? s : undefined;
}

function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Active users holding a given permission — a small local duplicate of the
 * equivalent helper in src/server/payments/record.ts, kept here rather than
 * imported across modules (matches this codebase's low-coupling convention
 * for that helper, per its own comment).
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

function categoryLabelAr(category: ManualJobCostCategory): string {
  switch (category) {
    case "hardware":
      return "مواد وتجهيزات";
    case "external_contractor":
      return "مقاول خارجي";
    case "aluminum_contractor":
      return "مقاول ألمنيوم";
    default:
      return "أخرى";
  }
}

const AddJobCostSchema = z.object({
  category: z.enum(MANUAL_JOB_COST_CATEGORIES, { error: "الفئة غير صحيحة" }),
  amount: z.string().trim().min(1, { error: "المبلغ مطلوب" }),
  description: z.string().trim().min(1, { error: "الوصف مطلوب" }),
  jobItemId: z.uuid().optional(),
  externalContractorId: z.uuid().optional(),
  vendorUserId: z.uuid().optional(),
  incurredAt: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, { error: "تاريخ غير صحيح" })
    .optional(),
});

/**
 * Records a general job cost — hardware / external_contractor /
 * aluminum_contractor / other ONLY (section 46/74). factory_glass is
 * booked automatically when a factory price is approved (Phase 6), and
 * installer_labor/daily_worker_labor are booked automatically by the
 * compensation module — entering either of those through this generic
 * form would create a duplicate/conflicting cost row for the same
 * economic event, so MANUAL_JOB_COST_CATEGORIES deliberately excludes
 * them (enforced by the zod enum above, not just by convention).
 *
 * Mirrors every other pending/auto-approve pattern in this codebase
 * (recordCustomerPayment, completeInstallationAction): auto-approved ONLY
 * for a super admin acting with an explicit, audited override (master
 * prompt section 9 — requester cannot normally approve their own request,
 * and holding APPROVE_REQUESTS is not by itself an exception to that).
 * Everyone else always lands in the pending queue, even if they hold
 * APPROVE_REQUESTS themselves — a *different* holder of that permission
 * must decide it.
 */
export async function addJobCostAction(
  jobId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!can(user, PERMISSIONS.MANAGE_JOB_COSTS)) {
    return { error: "لا تملك صلاحية تسجيل تكاليف المهمة." };
  }

  const parsed = AddJobCostSchema.safeParse({
    category: formData.get("category"),
    amount: formData.get("amount"),
    description: formData.get("description"),
    jobItemId: emptyToUndefined(formData.get("jobItemId")),
    externalContractorId: emptyToUndefined(formData.get("externalContractorId")),
    vendorUserId: emptyToUndefined(formData.get("vendorUserId")),
    incurredAt: emptyToUndefined(formData.get("incurredAt")),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" };
  }

  const amount = parseNonNegativeMoneyInput(parsed.data.amount);
  if (amount === null || !isPositive(amount)) {
    return { error: "المبلغ غير صحيح" };
  }

  const autoApproved = isSuperAdmin(user);
  const now = new Date();
  const incurredAt = parsed.data.incurredAt ?? todayDateString();

  await db.transaction(async (tx) => {
    const [cost] = await tx
      .insert(jobCosts)
      .values({
        jobId,
        jobItemId: parsed.data.jobItemId,
        category: parsed.data.category,
        amount,
        description: parsed.data.description,
        vendorUserId: parsed.data.vendorUserId,
        externalContractorId: parsed.data.externalContractorId,
        status: autoApproved ? "approved" : "pending",
        createdByUserId: user!.id,
        approvedByUserId: autoApproved ? user!.id : undefined,
        approvedAt: autoApproved ? now : undefined,
        incurredAt,
      })
      .returning({ id: jobCosts.id });

    if (!autoApproved) {
      await createApprovalRequest(tx, {
        entityType: "job_cost",
        entityId: cost.id,
        requestedByUserId: user!.id,
        summary: `تكلفة ${categoryLabelAr(parsed.data.category)} بمبلغ ${formatILS(amount)}`,
        relatedJobId: jobId,
      });
    }

    await recordAudit(
      {
        userId: user!.id,
        action: "job_cost.create",
        entityType: "job_cost",
        entityId: cost.id,
        newValue: {
          jobId,
          category: parsed.data.category,
          amount,
          autoApproved,
          ...(autoApproved ? { selfApprovalOverride: true } : {}),
        },
      },
      tx,
    );

    return cost.id;
  });

  if (!autoApproved) {
    const approverIds = await getUserIdsWithPermission(PERMISSIONS.APPROVE_REQUESTS);
    await notifyUsers(approverIds, {
      type: "job_cost_pending_approval",
      title: "تكلفة مهمة بانتظار الاعتماد",
      relatedEntityType: "job",
      relatedEntityId: jobId,
    });
  }

  revalidatePath(`/jobs/${jobId}`);
  return { success: true };
}

const DecideJobCostSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  rejectionReason: z.string().trim().optional(),
});

/**
 * Decides a pending job cost (section 61) — the ONE place that flips
 * job_costs.status, always in the same transaction as the matching
 * approval_requests row's decision. Race-safe against a double-decide
 * (double-click, two approvers): the UPDATE only affects a row still
 * 'pending', and its returned row count is the real guard — the plain
 * SELECT above is just a fast-fail for the common case.
 */
export async function decideJobCostAction(
  costId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!can(user, PERMISSIONS.APPROVE_REQUESTS)) {
    return { error: "لا تملك صلاحية اعتماد طلبات الموافقة." };
  }

  const parsed = DecideJobCostSchema.safeParse({
    decision: formData.get("decision"),
    rejectionReason: emptyToUndefined(formData.get("rejectionReason")),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" };
  }

  const [cost] = await db.select().from(jobCosts).where(eq(jobCosts.id, costId)).limit(1);
  if (!cost) return { error: "التكلفة غير موجودة." };
  if (cost.status !== "pending") {
    return { error: "تم اتخاذ قرار بشأن هذه التكلفة بالفعل." };
  }

  const selfApproval = requesterMayApprove(user, cost.createdByUserId);
  if (!selfApproval.allowed) {
    return { error: "لا يمكنك اعتماد تكلفة سجّلتها بنفسك." };
  }

  const [request] = await db
    .select()
    .from(approvalRequests)
    .where(
      and(
        eq(approvalRequests.entityType, "job_cost"),
        eq(approvalRequests.entityId, costId),
        eq(approvalRequests.status, "pending"),
      ),
    )
    .limit(1);

  const approved = parsed.data.decision === "approve";
  const now = new Date();
  let alreadyDecided = false;

  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(jobCosts)
      .set(
        approved
          ? { status: "approved", approvedByUserId: user!.id, approvedAt: now }
          : { status: "rejected" },
      )
      .where(and(eq(jobCosts.id, costId), eq(jobCosts.status, "pending")))
      .returning({ id: jobCosts.id });

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
        action: "job_cost.decide",
        entityType: "job_cost",
        entityId: costId,
        newValue: {
          decision: parsed.data.decision,
          ...(selfApproval.isOverride ? { selfApprovalOverride: true } : {}),
        },
      },
      tx,
    );
  });

  if (alreadyDecided) {
    return { error: "تم اتخاذ قرار بشأن هذه التكلفة بالفعل." };
  }

  if (cost.createdByUserId) {
    await notifyUser({
      userId: cost.createdByUserId,
      type: "job_cost_decided",
      title: approved ? "تم اعتماد تكلفة المهمة" : "تم رفض تكلفة المهمة",
      relatedEntityType: "job",
      relatedEntityId: cost.jobId,
    });
  }

  revalidatePath(`/jobs/${cost.jobId}`);
  return { success: true };
}
