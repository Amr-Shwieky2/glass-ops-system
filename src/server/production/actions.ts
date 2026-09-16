"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  jobs,
  productionRequests,
  factoryPublicLinks,
  factorySubmissions,
  users,
  userPermissions,
} from "@/server/db/schema";
import { getCurrentUser } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { PERMISSIONS, type PermissionKey } from "@/server/auth/permission-keys";
import { recordAudit } from "@/server/audit";
import { notifyUsers } from "@/server/notifications";
import { parseNonNegativeMoneyInput, formatILS } from "@/server/money";
import { createApprovalRequest } from "@/server/approvals/decide";
import { lockJobForWrite } from "@/server/jobs/locking";
import { createProductionRequest, FACTORY_LINK_VALIDITY_DAYS } from "./create-request";
import { checkRateLimit } from "@/server/security/rate-limit";
import { assertJobVisible } from "@/server/jobs/access";
import { generateSecureToken } from "@/server/tokens";

export interface ActionState {
  error?: string;
  success?: boolean;
}

function emptyToUndefined(value: FormDataEntryValue | null): string | undefined {
  const s = typeof value === "string" ? value.trim() : "";
  return s.length > 0 ? s : undefined;
}

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

// ---------------------------------------------------------------------
// Send a job to the factory (section 43). A production request has no
// separate draft phase the way a quote does (factory_status has no
// 'draft' value) — creating the request IS sending it: it immediately
// issues the factory's public link, in the same transaction.
// ---------------------------------------------------------------------
const SendToFactorySchema = z.object({
  details: z.string().trim().min(1, { error: "أضف تفاصيل الطلب" }),
  estimatedReadyDate: z.string().trim().optional(),
});

export interface SendToFactoryState extends ActionState {
  publicPath?: string;
}

export async function sendToFactoryAction(
  jobId: string,
  _prevState: SendToFactoryState,
  formData: FormData,
): Promise<SendToFactoryState> {
  const user = await getCurrentUser();
  if (!can(user, PERMISSIONS.CREATE_PRODUCTION_ORDER)) {
    return { error: "لا تملك صلاحية إرسال طلبات إنتاج." };
  }
  const visErr = await assertJobVisible(user, jobId);
  if (visErr) return { error: visErr };

  const parsed = SendToFactorySchema.safeParse({
    details: formData.get("details"),
    estimatedReadyDate: emptyToUndefined(formData.get("estimatedReadyDate")),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" };
  }

  // The job's terminal status and "already sent to factory" state are
  // re-checked below, INSIDE the transaction, under a row lock
  // (lockJobForWrite) — not from a plain pre-transaction SELECT. That's
  // what stops this manual click and the automatic-on-signing path
  // (runPostSignAutomation, src/server/quotes/actions.ts) from ever both
  // passing their "not yet sent" check for the same job; see
  // lockJobForWrite's doc comment.
  let token = "";
  let result: SendToFactoryState = { success: true };
  await db.transaction(async (tx) => {
    const locked = await lockJobForWrite(tx, jobId);
    if (!locked) {
      result = { error: "المهمة غير موجودة" };
      return;
    }
    if (locked.isTerminal) {
      result = { error: "لا يمكن إرسال مهمة مغلقة إلى المصنع." };
      return;
    }

    const [existing] = await tx
      .select({ id: productionRequests.id })
      .from(productionRequests)
      .where(eq(productionRequests.jobId, jobId))
      .limit(1);
    if (existing) {
      result = { error: "تم إرسال هذه المهمة إلى المصنع بالفعل." };
      return;
    }

    const created = await createProductionRequest(tx, {
      jobId,
      details: parsed.data.details,
      estimatedReadyDate: parsed.data.estimatedReadyDate || null,
      requestedByUserId: user!.id,
    });
    token = created.token;
  });
  if (result.error) return result;

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/production");
  return { success: true, publicPath: `/public/pr/${token}` };
}

// ---------------------------------------------------------------------
// Public factory price submission (section 44) — NO permission check: the
// long random token is the security boundary, exactly like public quote
// signing. Blocked once approved (nothing left to submit) or while a
// submission is already awaiting our review; allowed again after a
// rejection, via the same link.
// ---------------------------------------------------------------------
const SubmitFactoryPriceSchema = z.object({
  submittedPrice: z.string().trim().min(1, { error: "السعر مطلوب" }),
  notes: z.string().trim().optional(),
  estimatedReadyDate: z.string().trim().optional(),
});

export async function submitFactoryPriceAction(
  token: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const rate = checkRateLimit(`factory-submit:${token}`, {
    maxAttempts: 10,
    windowMs: 10 * 60_000,
    blockMs: 10 * 60_000,
  });
  if (!rate.allowed) {
    return { error: "محاولات كثيرة جداً. حاول مرة أخرى بعد قليل." };
  }

  const parsed = SubmitFactoryPriceSchema.safeParse({
    submittedPrice: formData.get("submittedPrice"),
    notes: emptyToUndefined(formData.get("notes")),
    estimatedReadyDate: emptyToUndefined(formData.get("estimatedReadyDate")),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" };
  }
  const submittedPrice = parseNonNegativeMoneyInput(parsed.data.submittedPrice);
  if (submittedPrice === null) return { error: "سعر غير صحيح" };

  const [link] = await db
    .select()
    .from(factoryPublicLinks)
    .where(eq(factoryPublicLinks.token, token))
    .limit(1);
  if (!link) return { error: "رابط غير صالح." };
  if (link.revokedAt) return { error: "تم إلغاء هذا الرابط." };
  if (link.expiresAt && link.expiresAt < new Date()) {
    return { error: "انتهت صلاحية هذا الرابط." };
  }

  const [request] = await db
    .select()
    .from(productionRequests)
    .where(eq(productionRequests.id, link.productionRequestId))
    .limit(1);
  if (!request) return { error: "تعذر العثور على طلب الإنتاج." };
  if (request.status === "approved") {
    return { error: "تم اعتماد سعر لهذا الطلب بالفعل." };
  }
  if (request.status === "submitted") {
    return { error: "هناك عرض سعر مُرسل بالفعل بانتظار المراجعة." };
  }

  let result: ActionState = { success: true };
  await db.transaction(async (tx) => {
    // Re-check status INSIDE the transaction under a row lock — the plain
    // SELECT above is just a fast-fail for the common case, not the real
    // guard. This is a PUBLIC, unauthenticated endpoint (a network retry
    // or two browser tabs on the same token both count), and unlike every
    // other check-then-act write in this codebase (sendToFactoryAction/
    // convertQuoteToJob/signQuotePublicly all lock; the approval-decision
    // actions all use a conditional UPDATE...WHERE status='pending' guard)
    // this one previously had no lock at all — two concurrent submissions
    // could both pass the check above before either committed, leaving two
    // independent 'pending' factorySubmissions rows for one request, each
    // independently approvable (approveFactorySubmission only checks the
    // individual submission's own status) into its own job_costs row —
    // silently double-booking the factory cost on the job.
    const [locked] = await tx
      .select({ status: productionRequests.status })
      .from(productionRequests)
      .where(eq(productionRequests.id, request.id))
      .for("update")
      .limit(1);
    if (!locked) {
      result = { error: "تعذر العثور على طلب الإنتاج." };
      return;
    }
    if (locked.status === "approved") {
      result = { error: "تم اعتماد سعر لهذا الطلب بالفعل." };
      return;
    }
    if (locked.status === "submitted") {
      result = { error: "هناك عرض سعر مُرسل بالفعل بانتظار المراجعة." };
      return;
    }

    const [submission] = await tx
      .insert(factorySubmissions)
      .values({
        productionRequestId: request.id,
        submittedPrice,
        notes: parsed.data.notes,
        estimatedReadyDate: parsed.data.estimatedReadyDate || null,
        submittedAt: new Date(),
      })
      .returning({ id: factorySubmissions.id });

    await tx
      .update(productionRequests)
      .set({ status: "submitted", updatedAt: new Date() })
      .where(eq(productionRequests.id, request.id));

    // Retrofit (Phase 10a): factory submissions predate createApprovalRequest
    // and have always tracked their own pending/approved/rejected state on
    // factorySubmissions.approvalStatus directly (see approve.ts) — this
    // adds the parallel approval_requests bookkeeping ADDITIVELY, purely so
    // the unified approvals queue (section 59/61) also surfaces these, it
    // changes nothing about the primary status machine above. There is no
    // "submitter" user (the factory link is public/tokenless), so we
    // attribute the request to whoever originally requested production —
    // always set today (sendToFactoryAction always fills it in), but the
    // column is nullable, so skip creating the row in that hypothetical
    // case rather than writing a hard non-null assertion.
    if (request.requestedByUserId) {
      const [job] = await tx
        .select({ jobNumber: jobs.jobNumber })
        .from(jobs)
        .where(eq(jobs.id, request.jobId))
        .limit(1);

      await createApprovalRequest(tx, {
        entityType: "factory_submission",
        entityId: submission.id,
        requestedByUserId: request.requestedByUserId,
        summary: `عرض سعر من المصنع للمهمة ${job?.jobNumber ?? ""} بمبلغ ${formatILS(submittedPrice)}`.trim(),
        relatedJobId: request.jobId,
      });
    }

    await recordAudit(
      {
        userId: null,
        action: "production_request.factory_submit",
        entityType: "production_request",
        entityId: request.id,
        newValue: { submittedPrice },
      },
      tx,
    );
  });
  if (result.error) return result;

  const approvers = await getUsersWithPermission(PERMISSIONS.APPROVE_FACTORY_PRICE);
  await notifyUsers(
    approvers.map((u) => u.id),
    {
      type: "factory_price_submitted",
      title: "المصنع أرسل سعراً بانتظار الاعتماد",
      relatedEntityType: "job",
      relatedEntityId: request.jobId,
    },
  );

  revalidatePath(`/public/pr/${token}`);
  revalidatePath(`/jobs/${request.jobId}`);
  revalidatePath("/production");
  return { success: true };
}

// ---------------------------------------------------------------------
// Factory public link management (Sprint 7, S7.5) — before this, a
// factory link's expiresAt/revokedAt columns existed but nothing in the
// codebase ever set revokedAt, and no staff-facing action to revoke or
// regenerate one existed at all.
// ---------------------------------------------------------------------

/** Revokes a job's currently active factory public link — e.g. it was
 * shared with the wrong factory, or sent by mistake. Does NOT create a
 * replacement; use regenerateFactoryLinkAction for that. */
export async function revokeFactoryLinkAction(
  jobId: string,
  linkId: string,
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!can(user, PERMISSIONS.CREATE_PRODUCTION_ORDER)) {
    return { error: "لا تملك صلاحية إدارة روابط المصنع." };
  }

  const [link] = await db
    .select({
      id: factoryPublicLinks.id,
      revokedAt: factoryPublicLinks.revokedAt,
      jobId: productionRequests.jobId,
    })
    .from(factoryPublicLinks)
    .innerJoin(productionRequests, eq(factoryPublicLinks.productionRequestId, productionRequests.id))
    .where(eq(factoryPublicLinks.id, linkId))
    .limit(1);
  if (!link) return { error: "الرابط غير موجود." };
  // Never trust the caller-supplied jobId over the link's own real job —
  // the same child-entity-mismatch check this codebase applies everywhere
  // a child row has its own authoritative parent reference.
  if (link.jobId !== jobId) return { error: "معرّف المهمة لا يطابق هذا الرابط." };
  const visErr = await assertJobVisible(user, link.jobId);
  if (visErr) return { error: visErr };
  if (link.revokedAt) return { error: "تم إلغاء هذا الرابط بالفعل." };

  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(factoryPublicLinks)
      .set({ revokedAt: new Date() })
      .where(and(eq(factoryPublicLinks.id, linkId), isNull(factoryPublicLinks.revokedAt)))
      .returning({ id: factoryPublicLinks.id });
    if (!updated) return; // already revoked by a concurrent request — no-op, not an error

    await recordAudit(
      {
        userId: user!.id,
        action: "factory_public_link.revoke",
        entityType: "factory_public_link",
        entityId: linkId,
        newValue: { jobId: link.jobId },
      },
      tx,
    );
  });

  revalidatePath(`/jobs/${link.jobId}`);
  revalidatePath("/production");
  return { success: true };
}

/** Revokes the current active link (if any) and issues a brand new one —
 * e.g. the previous link expired, or a fresh validity window is needed
 * without re-entering the request's details. Mirrors createProductionRequest's
 * own link-issuing logic exactly (same token generation, same validity
 * window) rather than duplicating a second, potentially-drifting copy. */
export async function regenerateFactoryLinkAction(
  jobId: string,
  productionRequestId: string,
): Promise<SendToFactoryState> {
  const user = await getCurrentUser();
  if (!can(user, PERMISSIONS.CREATE_PRODUCTION_ORDER)) {
    return { error: "لا تملك صلاحية إدارة روابط المصنع." };
  }

  const [request] = await db
    .select({ jobId: productionRequests.jobId })
    .from(productionRequests)
    .where(eq(productionRequests.id, productionRequestId))
    .limit(1);
  if (!request) return { error: "طلب الإنتاج غير موجود." };
  if (request.jobId !== jobId) return { error: "معرّف المهمة لا يطابق طلب الإنتاج." };
  const visErr = await assertJobVisible(user, request.jobId);
  if (visErr) return { error: visErr };

  const token = generateSecureToken();
  const expiresAt = new Date(Date.now() + FACTORY_LINK_VALIDITY_DAYS * 24 * 60 * 60_000);

  await db.transaction(async (tx) => {
    await tx
      .update(factoryPublicLinks)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(factoryPublicLinks.productionRequestId, productionRequestId),
          isNull(factoryPublicLinks.revokedAt),
        ),
      );

    await tx.insert(factoryPublicLinks).values({
      productionRequestId,
      token,
      expiresAt,
    });

    await recordAudit(
      {
        userId: user!.id,
        action: "factory_public_link.regenerate",
        entityType: "factory_public_link",
        entityId: productionRequestId,
        newValue: { jobId: request.jobId },
      },
      tx,
    );
  });

  revalidatePath(`/jobs/${request.jobId}`);
  revalidatePath("/production");
  return { success: true, publicPath: `/public/pr/${token}` };
}
