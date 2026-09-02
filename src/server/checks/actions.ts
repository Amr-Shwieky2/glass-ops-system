"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { incomingChecks, outgoingChecks } from "@/server/db/schema";
import { getCurrentUser } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { PERMISSIONS } from "@/server/auth/permission-keys";
import { recordAudit } from "@/server/audit";
import { parseNonNegativeMoneyInput, isPositive } from "@/server/money";
import { getSetting } from "@/server/settings";
import { isCheckDueSoon } from "@/server/checks/queries";

export interface ActionState {
  error?: string;
  success?: boolean;
}

function emptyToUndefined(value: FormDataEntryValue | null): string | undefined {
  const s = typeof value === "string" ? value.trim() : "";
  return s.length > 0 ? s : undefined;
}

const dueDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { error: "تاريخ الاستحقاق غير صحيح" });

// ---------------------------------------------------------------------
// Incoming checks (section 37)
// ---------------------------------------------------------------------

const CreateIncomingCheckSchema = z.object({
  customerId: z.uuid({ error: "العميل مطلوب" }),
  jobId: z.uuid().optional(),
  amount: z.string().trim().min(1, { error: "المبلغ مطلوب" }),
  checkNumber: z.string().trim().optional(),
  bank: z.string().trim().optional(),
  dueDate: dueDateSchema,
  notes: z.string().trim().optional(),
});

/** Records a check received from a customer (section 37). */
export async function createIncomingCheckAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!can(user, PERMISSIONS.MANAGE_CHECKS)) {
    return { error: "لا تملك صلاحية إدارة الشيكات." };
  }

  const parsed = CreateIncomingCheckSchema.safeParse({
    customerId: formData.get("customerId"),
    jobId: emptyToUndefined(formData.get("jobId")),
    amount: formData.get("amount"),
    checkNumber: emptyToUndefined(formData.get("checkNumber")),
    bank: emptyToUndefined(formData.get("bank")),
    dueDate: formData.get("dueDate"),
    notes: emptyToUndefined(formData.get("notes")),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" };
  }

  const amount = parseNonNegativeMoneyInput(parsed.data.amount);
  if (amount === null || !isPositive(amount)) {
    return { error: "المبلغ غير صحيح" };
  }

  const thresholdDays = (await getSetting("notification_thresholds")).checkDueSoonDays;
  const initialStatus = isCheckDueSoon(parsed.data.dueDate, thresholdDays) ? "due_soon" : "future";

  const [check] = await db
    .insert(incomingChecks)
    .values({
      customerId: parsed.data.customerId,
      jobId: parsed.data.jobId,
      amount,
      checkNumber: parsed.data.checkNumber,
      bank: parsed.data.bank,
      dueDate: parsed.data.dueDate,
      receivedByUserId: user!.id,
      status: initialStatus,
      notes: parsed.data.notes,
    })
    .returning();

  await recordAudit({
    userId: user!.id,
    action: "incoming_check.create",
    entityType: "incoming_check",
    entityId: check.id,
    newValue: { customerId: check.customerId, amount, dueDate: check.dueDate, status: initialStatus },
  });

  revalidatePath("/finance/checks");
  if (parsed.data.jobId) revalidatePath(`/jobs/${parsed.data.jobId}`);
  return { success: true };
}

const UpdateIncomingCheckStatusSchema = z.object({
  status: z.enum(["deposited", "cleared", "failed", "cancelled"], {
    error: "حالة غير صحيحة",
  }),
});

/**
 * Manually moves an incoming check to an explicit status (section 39):
 * "Never automatically assume that a check cleared. Someone must
 * explicitly select..." — 'future'/'due_soon' are never accepted here,
 * they are computed automatically (see isCheckDueSoon), never set by hand.
 */
export async function updateIncomingCheckStatusAction(
  checkId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!can(user, PERMISSIONS.MANAGE_CHECKS)) {
    return { error: "لا تملك صلاحية إدارة الشيكات." };
  }

  const parsed = UpdateIncomingCheckStatusSchema.safeParse({
    status: formData.get("status"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" };
  }

  const [existing] = await db
    .select({ id: incomingChecks.id, status: incomingChecks.status, jobId: incomingChecks.jobId })
    .from(incomingChecks)
    .where(eq(incomingChecks.id, checkId))
    .limit(1);
  if (!existing) return { error: "الشيك غير موجود." };

  const oldStatus = existing.status;

  await db.transaction(async (tx) => {
    await tx
      .update(incomingChecks)
      .set({
        status: parsed.data.status,
        statusUpdatedByUserId: user!.id,
        updatedAt: new Date(),
      })
      .where(eq(incomingChecks.id, checkId));

    await recordAudit(
      {
        userId: user!.id,
        action: "incoming_check.update_status",
        entityType: "incoming_check",
        entityId: checkId,
        oldValue: { status: oldStatus },
        newValue: { status: parsed.data.status },
      },
      tx,
    );
  });

  revalidatePath("/finance/checks");
  if (existing.jobId) revalidatePath(`/jobs/${existing.jobId}`);
  return { success: true };
}

// ---------------------------------------------------------------------
// Outgoing checks (section 38)
// ---------------------------------------------------------------------

const CreateOutgoingCheckSchema = z.object({
  payeeName: z.string().trim().min(1, { error: "اسم المستفيد مطلوب" }),
  amount: z.string().trim().min(1, { error: "المبلغ مطلوب" }),
  checkNumber: z.string().trim().optional(),
  dueDate: dueDateSchema,
  reason: z.string().trim().optional(),
  jobId: z.uuid().optional(),
});

/** Records a company-issued check (section 38). */
export async function createOutgoingCheckAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!can(user, PERMISSIONS.MANAGE_CHECKS)) {
    return { error: "لا تملك صلاحية إدارة الشيكات." };
  }

  const parsed = CreateOutgoingCheckSchema.safeParse({
    payeeName: formData.get("payeeName"),
    amount: formData.get("amount"),
    checkNumber: emptyToUndefined(formData.get("checkNumber")),
    dueDate: formData.get("dueDate"),
    reason: emptyToUndefined(formData.get("reason")),
    jobId: emptyToUndefined(formData.get("jobId")),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" };
  }

  const amount = parseNonNegativeMoneyInput(parsed.data.amount);
  if (amount === null || !isPositive(amount)) {
    return { error: "المبلغ غير صحيح" };
  }

  const [check] = await db
    .insert(outgoingChecks)
    .values({
      payeeName: parsed.data.payeeName,
      amount,
      checkNumber: parsed.data.checkNumber,
      dueDate: parsed.data.dueDate,
      reason: parsed.data.reason,
      jobId: parsed.data.jobId,
      createdByUserId: user!.id,
    })
    .returning();

  await recordAudit({
    userId: user!.id,
    action: "outgoing_check.create",
    entityType: "outgoing_check",
    entityId: check.id,
    newValue: { payeeName: check.payeeName, amount, dueDate: check.dueDate },
  });

  revalidatePath("/finance/checks");
  if (parsed.data.jobId) revalidatePath(`/jobs/${parsed.data.jobId}`);
  return { success: true };
}

const UpdateOutgoingCheckStatusSchema = z.object({
  status: z.enum(["issued", "cleared", "failed", "cancelled"], {
    error: "حالة غير صحيحة",
  }),
});

/**
 * Manually moves an outgoing check to an explicit status (section 39,
 * same "never auto-transition" rule as the incoming side) — 'pending' is
 * only ever the initial default, never a manual target here.
 */
export async function updateOutgoingCheckStatusAction(
  checkId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!can(user, PERMISSIONS.MANAGE_CHECKS)) {
    return { error: "لا تملك صلاحية إدارة الشيكات." };
  }

  const parsed = UpdateOutgoingCheckStatusSchema.safeParse({
    status: formData.get("status"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" };
  }

  const [existing] = await db
    .select({ id: outgoingChecks.id, status: outgoingChecks.status, jobId: outgoingChecks.jobId })
    .from(outgoingChecks)
    .where(eq(outgoingChecks.id, checkId))
    .limit(1);
  if (!existing) return { error: "الشيك غير موجود." };

  const oldStatus = existing.status;

  await db.transaction(async (tx) => {
    await tx
      .update(outgoingChecks)
      .set({ status: parsed.data.status, updatedAt: new Date() })
      .where(eq(outgoingChecks.id, checkId));

    await recordAudit(
      {
        userId: user!.id,
        action: "outgoing_check.update_status",
        entityType: "outgoing_check",
        entityId: checkId,
        oldValue: { status: oldStatus },
        newValue: { status: parsed.data.status },
      },
      tx,
    );
  });

  revalidatePath("/finance/checks");
  if (existing.jobId) revalidatePath(`/jobs/${existing.jobId}`);
  return { success: true };
}
