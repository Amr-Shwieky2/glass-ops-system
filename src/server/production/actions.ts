"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  jobs,
  jobStatuses,
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
import { createProductionRequest } from "./create-request";

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

  const parsed = SendToFactorySchema.safeParse({
    details: formData.get("details"),
    estimatedReadyDate: emptyToUndefined(formData.get("estimatedReadyDate")),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" };
  }

  const [job] = await db
    .select({ id: jobs.id, isTerminal: jobStatuses.isTerminal })
    .from(jobs)
    .innerJoin(jobStatuses, eq(jobs.statusId, jobStatuses.id))
    .where(eq(jobs.id, jobId))
    .limit(1);
  if (!job) return { error: "المهمة غير موجودة" };
  if (job.isTerminal) return { error: "لا يمكن إرسال مهمة مغلقة إلى المصنع." };

  const [existing] = await db
    .select({ id: productionRequests.id })
    .from(productionRequests)
    .where(eq(productionRequests.jobId, jobId))
    .limit(1);
  if (existing) {
    return { error: "تم إرسال هذه المهمة إلى المصنع بالفعل." };
  }

  let token = "";
  await db.transaction(async (tx) => {
    const result = await createProductionRequest(tx, {
      jobId,
      details: parsed.data.details,
      estimatedReadyDate: parsed.data.estimatedReadyDate || null,
      requestedByUserId: user!.id,
    });
    token = result.token;
  });

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

  await db.transaction(async (tx) => {
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
