"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  productionRequests,
  factorySubmissions,
  jobCosts,
  approvalRequests,
  jobAssignments,
  jobs,
  users,
  userPermissions,
} from "@/server/db/schema";
import { getCurrentUser } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { PERMISSIONS, type PermissionKey } from "@/server/auth/permission-keys";
import { recordAudit } from "@/server/audit";
import { notifyUser, notifyUsers } from "@/server/notifications";
import { advanceJobStatus } from "@/server/jobs/status";
import { getTodayDateString } from "@/lib/company-day";
import type { ActionState } from "./actions";

async function getUsersWithPermission(permissionKey: PermissionKey) {
  return db
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
}

/**
 * Installer side of post-signing automation (Sprint 4) — the job just
 * became genuinely ready for installation (see advanceJobStatus(..,
 * "ready_from_factory") right above this function's call sites). If an
 * installer is already assigned (job_assignments, "تعيين فني" — an
 * independent mechanism from scheduling an installation appointment, see
 * needs-attention.ts's getJobsNeedingInstallerAssignment doc comment),
 * dispatch them a notification now instead of leaving them to discover it.
 * If nobody is assigned at all, this job is exactly what
 * getJobsNeedingInstallerAssignment's dashboard tile will start surfacing —
 * additionally nudge every ASSIGN_INSTALLER holder immediately rather than
 * waiting for them to notice the dashboard on their own.
 */
async function dispatchInstallerForReadyJob(jobId: string, jobNumber: string): Promise<void> {
  const assignedInstallers = await db
    .select({ userId: jobAssignments.userId })
    .from(jobAssignments)
    .where(eq(jobAssignments.jobId, jobId));
  const installerUserIds = Array.from(
    new Set(assignedInstallers.map((a) => a.userId).filter((id): id is string => !!id)),
  );

  if (installerUserIds.length > 0) {
    await notifyUsers(installerUserIds, {
      type: "job_ready_for_installation",
      title: `المهمة ${jobNumber} جاهزة للتركيب`,
      relatedEntityType: "job",
      relatedEntityId: jobId,
    });
    return;
  }

  const assignHolders = await getUsersWithPermission(PERMISSIONS.ASSIGN_INSTALLER);
  await notifyUsers(
    assignHolders.map((u) => u.id),
    {
      type: "job_needs_installer_assignment",
      title: `المهمة ${jobNumber} جاهزة للتركيب ولا يوجد فني معيّن`,
      body: "عيّن فني تركيب على المهمة من صفحتها.",
      relatedEntityType: "job",
      relatedEntityId: jobId,
    },
  );
}

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

  const [request] = await db
    .select()
    .from(productionRequests)
    .where(eq(productionRequests.id, submission.productionRequestId))
    .limit(1);
  if (!request) return { error: "طلب الإنتاج غير موجود." };

  // The submission's OWN request.jobId is the only jobId ever written
  // below — never the caller-supplied parameter. Without this, a tampered
  // client call could book a real, approved factory cost (and advance job
  // status) on a job the caller merely names, not the one the factory
  // actually priced. A mismatch here means the UI passed a stale/wrong id;
  // treat it as a hard error rather than silently substituting the correct
  // one, so a genuine bug surfaces instead of being masked.
  if (request.jobId !== jobId) {
    return { error: "معرّف المهمة لا يطابق طلب الإنتاج." };
  }

  // No requester-vs-approver check here, deliberately: the submitted PRICE
  // comes from the factory over an unauthenticated public link (see
  // production/actions.ts submitFactoryPriceAction), never from a company
  // user — request.requestedByUserId is only who routed the job TO the
  // factory, a different thing from who is financially vouching for the
  // price. A manager approving factory pricing on a job they themselves
  // sent to production is normal operation, not the self-dealing the
  // master prompt's section 9 rule targets.
  const now = new Date();
  let alreadyDecided = false;
  await db.transaction(async (tx) => {
    // Lock the submission row so a concurrent approve/reject can't also
    // pass its own pre-check before either commits — then the UPDATE's own
    // WHERE approvalStatus='pending' is the real, race-safe guard (the
    // lock alone isn't enough once other sessions can read committed rows
    // between statements; the conditional UPDATE is what actually decides
    // the winner).
    await tx
      .select({ id: factorySubmissions.id })
      .from(factorySubmissions)
      .where(eq(factorySubmissions.id, submissionId))
      .for("update", { of: factorySubmissions });

    const [updated] = await tx
      .update(factorySubmissions)
      .set({ approvalStatus: "approved", approvedByUserId: user!.id, approvedAt: now })
      .where(
        and(
          eq(factorySubmissions.id, submissionId),
          eq(factorySubmissions.approvalStatus, "pending"),
        ),
      )
      .returning({ id: factorySubmissions.id });

    if (!updated) {
      alreadyDecided = true;
      return;
    }

    await tx
      .update(productionRequests)
      .set({ status: "approved", updatedAt: now })
      .where(eq(productionRequests.id, request.id));

    await tx.insert(jobCosts).values({
      jobId: request.jobId,
      category: "factory_glass",
      amount: submission.submittedPrice,
      description: submission.notes ?? "تكلفة زجاج المصنع (معتمدة).",
      status: "approved",
      createdByUserId: user!.id,
      approvedByUserId: user!.id,
      approvedAt: now,
      incurredAt: getTodayDateString(now),
    });

    await advanceJobStatus(tx, request.jobId, "ready_from_factory");

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

  if (alreadyDecided) {
    return { error: "تم اتخاذ قرار بشأن هذا العرض بالفعل." };
  }

  if (request.requestedByUserId && request.requestedByUserId !== user!.id) {
    await notifyUser({
      userId: request.requestedByUserId,
      type: "factory_price_approved",
      title: "تم اعتماد سعر المصنع",
      relatedEntityType: "job",
      relatedEntityId: request.jobId,
    });
  }

  const [readyJob] = await db
    .select({ jobNumber: jobs.jobNumber })
    .from(jobs)
    .where(eq(jobs.id, request.jobId))
    .limit(1);
  if (readyJob) {
    await dispatchInstallerForReadyJob(request.jobId, readyJob.jobNumber);
  }

  revalidatePath(`/jobs/${request.jobId}`);
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

  const [request] = await db
    .select()
    .from(productionRequests)
    .where(eq(productionRequests.id, submission.productionRequestId))
    .limit(1);
  if (!request) return { error: "طلب الإنتاج غير موجود." };

  // See the matching comment in approveFactorySubmission: the submission's
  // own request.jobId is authoritative, never the caller-supplied jobId.
  if (request.jobId !== jobId) {
    return { error: "معرّف المهمة لا يطابق طلب الإنتاج." };
  }

  // No requester-vs-approver check here — see the matching comment in
  // approveFactorySubmission above.
  const now = new Date();
  let alreadyDecided = false;
  await db.transaction(async (tx) => {
    await tx
      .select({ id: factorySubmissions.id })
      .from(factorySubmissions)
      .where(eq(factorySubmissions.id, submissionId))
      .for("update", { of: factorySubmissions });

    const [updated] = await tx
      .update(factorySubmissions)
      .set({
        approvalStatus: "rejected",
        approvedByUserId: user!.id,
        approvedAt: now,
        rejectionReason: parsed.data.rejectionReason,
      })
      .where(
        and(
          eq(factorySubmissions.id, submissionId),
          eq(factorySubmissions.approvalStatus, "pending"),
        ),
      )
      .returning({ id: factorySubmissions.id });

    if (!updated) {
      alreadyDecided = true;
      return;
    }

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

  if (alreadyDecided) {
    return { error: "تم اتخاذ قرار بشأن هذا العرض بالفعل." };
  }

  if (request.requestedByUserId && request.requestedByUserId !== user!.id) {
    await notifyUser({
      userId: request.requestedByUserId,
      type: "factory_price_rejected",
      title: "تم رفض سعر المصنع",
      body: parsed.data.rejectionReason,
      relatedEntityType: "job",
      relatedEntityId: request.jobId,
    });
  }

  revalidatePath(`/jobs/${request.jobId}`);
  revalidatePath("/production");
  return { success: true };
}
