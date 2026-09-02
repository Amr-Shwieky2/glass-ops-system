"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  productionRequests,
  factorySubmissions,
  jobCosts,
  approvalRequests,
} from "@/server/db/schema";
import { getCurrentUser } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { PERMISSIONS } from "@/server/auth/permission-keys";
import { recordAudit } from "@/server/audit";
import { notifyUser } from "@/server/notifications";
import { advanceJobStatus } from "@/server/jobs/status";
import type { ActionState } from "./actions";

/**
 * Deciding on the factory's submitted price (section 45). Approving books
 * the job_costs row in the SAME transaction, with the SAME approver/
 * timestamp as the submission's own approval fields — "the price is right"
 * and "the cost is real" are one decision, never two (mirrors the labor
 * cost / ledger pairing in ARCHITECTURE.md section 5). By the time a
 * factory names its price the glass is typically already made, so approval
 * also advances the job to "ready from factory".
 */
export async function approveFactorySubmission(
  jobId: string,
  submissionId: string,
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!can(user, PERMISSIONS.APPROVE_FACTORY_PRICE)) {
    return { error: "لا تملك صلاحية اعتماد سعر المصنع." };
  }

  const [submission] = await db
    .select()
    .from(factorySubmissions)
    .where(eq(factorySubmissions.id, submissionId))
    .limit(1);
  if (!submission) return { error: "العرض غير موجود." };
  if (submission.approvalStatus !== "pending") {
    return { error: "تم اتخاذ قرار بشأن هذا العرض بالفعل." };
  }

  const [request] = await db
    .select()
    .from(productionRequests)
    .where(eq(productionRequests.id, submission.productionRequestId))
    .limit(1);
  if (!request) return { error: "طلب الإنتاج غير موجود." };

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(factorySubmissions)
      .set({ approvalStatus: "approved", approvedByUserId: user!.id, approvedAt: now })
      .where(eq(factorySubmissions.id, submissionId));

    await tx
      .update(productionRequests)
      .set({ status: "approved", updatedAt: now })
      .where(eq(productionRequests.id, request.id));

    await tx.insert(jobCosts).values({
      jobId,
      category: "factory_glass",
      amount: submission.submittedPrice,
      description: submission.notes ?? "تكلفة زجاج المصنع (معتمدة).",
      status: "approved",
      createdByUserId: user!.id,
      approvedByUserId: user!.id,
      approvedAt: now,
      incurredAt: now.toISOString().slice(0, 10),
    });

    await advanceJobStatus(tx, jobId, "ready_from_factory");

    // Retrofit (Phase 10a, additive-only): mirror this decision onto the
    // matching approval_requests row so the unified approvals queue drops
    // it too. Race-safe conditional UPDATE like every other decide action
    // (src/server/approvals/decide.ts) — WHERE status = 'pending', so a
    // concurrent decider can't double-write it. This is pure bookkeeping
    // for the queue; the real decision above is factorySubmissions.approvalStatus.
    await tx
      .update(approvalRequests)
      .set({
        status: "approved",
        decidedByUserId: user!.id,
        decidedAt: now,
        rejectionReason: null,
      })
      .where(
        and(
          eq(approvalRequests.entityType, "factory_submission"),
          eq(approvalRequests.entityId, submissionId),
          eq(approvalRequests.status, "pending"),
        ),
      );

    await recordAudit(
      {
        userId: user!.id,
        action: "production_request.approve",
        entityType: "production_request",
        entityId: request.id,
        newValue: { submissionId, amount: submission.submittedPrice },
      },
      tx,
    );
  });

  if (request.requestedByUserId && request.requestedByUserId !== user!.id) {
    await notifyUser({
      userId: request.requestedByUserId,
      type: "factory_price_approved",
      title: "تم اعتماد سعر المصنع",
      relatedEntityType: "job",
      relatedEntityId: jobId,
    });
  }

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/production");
  return { success: true };
}

const RejectSchema = z.object({
  rejectionReason: z.string().trim().min(1, { error: "سبب الرفض مطلوب" }),
});

/** Rejecting leaves the job status untouched (no forward progress to
 * undo) — the factory can submit a new price through the same public
 * link, seeing this reason. */
export async function rejectFactorySubmission(
  jobId: string,
  submissionId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!can(user, PERMISSIONS.APPROVE_FACTORY_PRICE)) {
    return { error: "لا تملك صلاحية اعتماد سعر المصنع." };
  }

  const parsed = RejectSchema.safeParse({
    rejectionReason: formData.get("rejectionReason"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" };
  }

  const [submission] = await db
    .select()
    .from(factorySubmissions)
    .where(eq(factorySubmissions.id, submissionId))
    .limit(1);
  if (!submission) return { error: "العرض غير موجود." };
  if (submission.approvalStatus !== "pending") {
    return { error: "تم اتخاذ قرار بشأن هذا العرض بالفعل." };
  }

  const [request] = await db
    .select()
    .from(productionRequests)
    .where(eq(productionRequests.id, submission.productionRequestId))
    .limit(1);
  if (!request) return { error: "طلب الإنتاج غير موجود." };

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(factorySubmissions)
      .set({
        approvalStatus: "rejected",
        approvedByUserId: user!.id,
        approvedAt: now,
        rejectionReason: parsed.data.rejectionReason,
      })
      .where(eq(factorySubmissions.id, submissionId));

    await tx
      .update(productionRequests)
      .set({ status: "rejected", updatedAt: now })
      .where(eq(productionRequests.id, request.id));

    // Retrofit (Phase 10a, additive-only) — see the matching comment in
    // approveFactorySubmission above.
    await tx
      .update(approvalRequests)
      .set({
        status: "rejected",
        decidedByUserId: user!.id,
        decidedAt: now,
        rejectionReason: parsed.data.rejectionReason,
      })
      .where(
        and(
          eq(approvalRequests.entityType, "factory_submission"),
          eq(approvalRequests.entityId, submissionId),
          eq(approvalRequests.status, "pending"),
        ),
      );

    await recordAudit(
      {
        userId: user!.id,
        action: "production_request.reject",
        entityType: "production_request",
        entityId: request.id,
        newValue: { submissionId, reason: parsed.data.rejectionReason },
      },
      tx,
    );
  });

  if (request.requestedByUserId && request.requestedByUserId !== user!.id) {
    await notifyUser({
      userId: request.requestedByUserId,
      type: "factory_price_rejected",
      title: "تم رفض سعر المصنع",
      body: parsed.data.rejectionReason,
      relatedEntityType: "job",
      relatedEntityId: jobId,
    });
  }

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/production");
  return { success: true };
}
