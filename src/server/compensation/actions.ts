"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  technicianLedgerEntries,
  approvalRequests,
  compensationRules,
  penaltyRules,
  bonusRules,
  jobs,
  users,
  userPermissions,
} from "@/server/db/schema";
import { getCurrentUser } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { PERMISSIONS, type PermissionKey } from "@/server/auth/permission-keys";
import { recordAudit } from "@/server/audit";
import { notifyUser, notifyUsers } from "@/server/notifications";
import { createApprovalRequest } from "@/server/approvals/decide";
import {
  parseNonNegativeMoneyInput,
  isPositive,
  multiplyMoney,
  subtractMoney,
  formatILS,
  type Money,
} from "@/server/money";
import { getSetting } from "@/server/settings";
import { writeLedgerEntry, pairInstallerLaborCost } from "@/server/compensation/ledger";

export interface ActionState {
  error?: string;
  success?: boolean;
}

function emptyToUndefined(value: FormDataEntryValue | null): string | undefined {
  const s = typeof value === "string" ? value.trim() : "";
  return s.length > 0 ? s : undefined;
}

/** Negates a Money value (money.ts has no dedicated helper for this — a
 * plain subtraction from zero is the documented way to combine Money
 * values without doing raw JS arithmetic on them). */
function negateMoney(amount: Money): Money {
  return subtractMoney("0.00", amount);
}

/**
 * Active users holding a given permission — a small local duplicate of the
 * equivalent helper in src/server/payments/record.ts, kept here rather
 * than imported across modules (this codebase's established low-coupling
 * convention for this exact helper — see that file's own comment).
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

async function userExists(userId: string): Promise<boolean> {
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
  return !!row;
}

async function jobExists(jobId: string): Promise<boolean> {
  const [row] = await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.id, jobId)).limit(1);
  return !!row;
}

const AllocateEarningSchema = z.object({
  userId: z.string().trim().min(1, { error: "الفني مطلوب" }),
  jobItemId: z.string().trim().optional(),
  isCustom: z.string().optional(),
  compensationRuleId: z.string().trim().optional(),
  quantity: z.string().trim().optional(),
  customDescription: z.string().trim().optional(),
  customAmount: z.string().trim().optional(),
});

/**
 * Allocates one technician's share of a job's installation earnings
 * (section 25) — call it once per person, each with their own amount,
 * never assuming an equal split. The actor already holds
 * MANAGE_TECHNICIAN_PAYMENTS to call this at all, so the allocation is
 * always immediately approved (no separate approval step) and its labor
 * job-cost is booked in the same transaction (ARCHITECTURE.md section 5).
 */
export async function allocateInstallationEarning(
  jobId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actingUser = await getCurrentUser();
  if (!can(actingUser, PERMISSIONS.MANAGE_TECHNICIAN_PAYMENTS)) {
    return { error: "لا تملك صلاحية تسجيل مستحقات الفنيين." };
  }

  const parsed = AllocateEarningSchema.safeParse({
    userId: formData.get("userId"),
    jobItemId: emptyToUndefined(formData.get("jobItemId")),
    isCustom: emptyToUndefined(formData.get("isCustom")),
    compensationRuleId: emptyToUndefined(formData.get("compensationRuleId")),
    quantity: emptyToUndefined(formData.get("quantity")),
    customDescription: emptyToUndefined(formData.get("customDescription")),
    customAmount: emptyToUndefined(formData.get("customAmount")),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" };
  }
  const data = parsed.data;

  if (!(await jobExists(jobId))) return { error: "المهمة غير موجودة." };
  if (!(await userExists(data.userId))) return { error: "المستخدم غير موجود." };

  let amount: Money;
  let description: string;
  let compensationRuleId: string | undefined;
  let quantity: string | undefined;
  let rateUsed: Money | undefined;

  const isCustom = data.isCustom === "true";
  if (isCustom) {
    if (!data.customDescription) return { error: "وصف المستحق مطلوب." };
    const customAmount = parseNonNegativeMoneyInput(data.customAmount);
    if (customAmount === null || !isPositive(customAmount)) {
      return { error: "المبلغ غير صحيح." };
    }
    amount = customAmount;
    description = data.customDescription;
  } else {
    if (!data.compensationRuleId) {
      return { error: "يجب اختيار بند تسعير أو إدخال مبلغ مخصص." };
    }
    const parsedQuantity = parseNonNegativeMoneyInput(data.quantity);
    if (parsedQuantity === null || !isPositive(parsedQuantity)) {
      return { error: "الكمية غير صحيحة." };
    }
    const [rule] = await db
      .select()
      .from(compensationRules)
      .where(eq(compensationRules.id, data.compensationRuleId))
      .limit(1);
    if (!rule) return { error: "بند التسعير غير موجود." };

    compensationRuleId = rule.id;
    quantity = parsedQuantity;
    rateUsed = rule.amount;
    amount = multiplyMoney(rule.amount, parsedQuantity);
    description = rule.label;
  }

  let ledgerEntryId = "";
  await db.transaction(async (tx) => {
    const result = await writeLedgerEntry(tx, {
      userId: data.userId,
      entryType: "installation_earning",
      amount,
      compensationRuleId,
      quantity,
      rateUsed,
      relatedJobId: jobId,
      relatedJobItemId: data.jobItemId,
      description,
      createdByUserId: actingUser!.id,
      approvalStatus: "approved",
      approvedByUserId: actingUser!.id,
    });
    ledgerEntryId = result.id;

    await pairInstallerLaborCost(tx, {
      ledgerEntryId,
      userId: data.userId,
      jobId,
      jobItemId: data.jobItemId,
      category: "installer_labor",
      amount,
      description,
      createdByUserId: actingUser!.id,
      approved: true,
    });

    await recordAudit(
      {
        userId: actingUser!.id,
        action: "technician_ledger_entry.allocate_installation_earning",
        entityType: "technician_ledger_entry",
        entityId: ledgerEntryId,
        newValue: { userId: data.userId, jobId, jobItemId: data.jobItemId, amount },
      },
      tx,
    );
  });

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath(`/technicians/${data.userId}`);
  return { success: true };
}

/**
 * Records a daily wage payment for a worker (section 27), defaulting to
 * users.dailyWageAmount when no override is given. Only pairs a job cost
 * (category='daily_worker_labor') when a jobId is present — a general
 * workshop day with no job still creates the ledger entry alone.
 */
export async function recordDailyWage(
  userId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actingUser = await getCurrentUser();
  if (!can(actingUser, PERMISSIONS.MANAGE_TECHNICIAN_PAYMENTS)) {
    return { error: "لا تملك صلاحية تسجيل الأجور اليومية." };
  }

  const date = emptyToUndefined(formData.get("date"));
  if (!date) return { error: "التاريخ مطلوب." };
  const jobId = emptyToUndefined(formData.get("jobId"));
  const amountRaw = emptyToUndefined(formData.get("amount"));

  const [targetUser] = await db
    .select({ id: users.id, dailyWageAmount: users.dailyWageAmount })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!targetUser) return { error: "المستخدم غير موجود." };

  let amount: Money;
  if (amountRaw) {
    const parsed = parseNonNegativeMoneyInput(amountRaw);
    if (parsed === null || !isPositive(parsed)) return { error: "المبلغ غير صحيح." };
    amount = parsed;
  } else if (targetUser.dailyWageAmount && isPositive(targetUser.dailyWageAmount)) {
    amount = targetUser.dailyWageAmount;
  } else {
    return { error: "لا يوجد أجر يومي محدد لهذا المستخدم — الرجاء إدخال مبلغ." };
  }

  if (jobId && !(await jobExists(jobId))) return { error: "المهمة غير موجودة." };

  const description = `أجر يومي — ${date}`;

  await db.transaction(async (tx) => {
    const { id: ledgerEntryId } = await writeLedgerEntry(tx, {
      userId,
      entryType: "daily_wage",
      amount,
      relatedJobId: jobId,
      description,
      createdByUserId: actingUser!.id,
      approvalStatus: "approved",
      approvedByUserId: actingUser!.id,
    });

    if (jobId) {
      await pairInstallerLaborCost(tx, {
        ledgerEntryId,
        userId,
        jobId,
        category: "daily_worker_labor",
        amount,
        description,
        createdByUserId: actingUser!.id,
        approved: true,
      });
    }

    await recordAudit(
      {
        userId: actingUser!.id,
        action: "technician_ledger_entry.record_daily_wage",
        entityType: "technician_ledger_entry",
        entityId: ledgerEntryId,
        newValue: { userId, date, jobId, amount },
      },
      tx,
    );
  });

  if (jobId) revalidatePath(`/jobs/${jobId}`);
  revalidatePath(`/technicians/${userId}`);
  return { success: true };
}

/**
 * Deducts a vehicle-usage amount from a technician's balance (section 26).
 * Affects only the technician's account — never books a job cost.
 */
export async function recordVehicleUsageDeduction(
  userId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actingUser = await getCurrentUser();
  if (!can(actingUser, PERMISSIONS.MANAGE_TECHNICIAN_PAYMENTS)) {
    return { error: "لا تملك صلاحية تسجيل خصومات استخدام المركبة." };
  }

  if (!(await userExists(userId))) return { error: "المستخدم غير موجود." };

  const reason = emptyToUndefined(formData.get("reason"));
  const amountRaw = emptyToUndefined(formData.get("amount"));

  let amount: Money;
  if (amountRaw) {
    const parsed = parseNonNegativeMoneyInput(amountRaw);
    if (parsed === null || !isPositive(parsed)) return { error: "المبلغ غير صحيح." };
    amount = parsed;
  } else {
    amount = await getSetting("vehicle_usage_deduction_default");
  }

  await db.transaction(async (tx) => {
    const { id: ledgerEntryId } = await writeLedgerEntry(tx, {
      userId,
      entryType: "vehicle_usage_deduction",
      amount: negateMoney(amount),
      description: reason ?? "خصم استخدام مركبة",
      createdByUserId: actingUser!.id,
      approvalStatus: "approved",
      approvedByUserId: actingUser!.id,
    });

    await recordAudit(
      {
        userId: actingUser!.id,
        action: "technician_ledger_entry.vehicle_usage_deduction",
        entityType: "technician_ledger_entry",
        entityId: ledgerEntryId,
        newValue: { userId, amount, reason },
      },
      tx,
    );
  });

  revalidatePath(`/technicians/${userId}`);
  return { success: true };
}

/** Records a bonus (section 31), from a predefined rule (amount defaults
 * to the rule's defaultAmount but can be overridden) or fully custom. */
export async function recordBonus(
  userId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actingUser = await getCurrentUser();
  if (!can(actingUser, PERMISSIONS.MANAGE_TECHNICIAN_PAYMENTS)) {
    return { error: "لا تملك صلاحية تسجيل المكافآت." };
  }

  if (!(await userExists(userId))) return { error: "المستخدم غير موجود." };

  const bonusRuleId = emptyToUndefined(formData.get("bonusRuleId"));
  const customDescription = emptyToUndefined(formData.get("customDescription"));
  const jobId = emptyToUndefined(formData.get("jobId"));
  const amountRaw = emptyToUndefined(formData.get("amount"));

  let rule: { id: string; label: string; defaultAmount: Money } | null = null;
  if (bonusRuleId) {
    const [row] = await db.select().from(bonusRules).where(eq(bonusRules.id, bonusRuleId)).limit(1);
    if (!row) return { error: "قاعدة المكافأة غير موجودة." };
    rule = row;
  }
  if (!rule && !customDescription) {
    return { error: "يجب اختيار مكافأة محددة أو إدخال وصف مخصص." };
  }

  let amount: Money;
  if (amountRaw) {
    const parsed = parseNonNegativeMoneyInput(amountRaw);
    if (parsed === null || !isPositive(parsed)) return { error: "المبلغ غير صحيح." };
    amount = parsed;
  } else if (rule) {
    amount = rule.defaultAmount;
  } else {
    return { error: "المبلغ مطلوب." };
  }

  if (jobId && !(await jobExists(jobId))) return { error: "المهمة غير موجودة." };

  const description = rule?.label ?? customDescription!;

  await db.transaction(async (tx) => {
    const { id: ledgerEntryId } = await writeLedgerEntry(tx, {
      userId,
      entryType: "bonus",
      amount,
      bonusRuleId: rule?.id,
      relatedJobId: jobId,
      description,
      createdByUserId: actingUser!.id,
      approvalStatus: "approved",
      approvedByUserId: actingUser!.id,
    });

    await recordAudit(
      {
        userId: actingUser!.id,
        action: "technician_ledger_entry.record_bonus",
        entityType: "technician_ledger_entry",
        entityId: ledgerEntryId,
        newValue: { userId, jobId, amount },
      },
      tx,
    );
  });

  if (jobId) revalidatePath(`/jobs/${jobId}`);
  revalidatePath(`/technicians/${userId}`);
  return { success: true };
}

/** Records a penalty (section 30). `reason` is always required — the
 * worker must be able to see what they were penalized for — and the
 * penalized worker is always notified with that reason. */
export async function recordPenalty(
  userId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actingUser = await getCurrentUser();
  if (!can(actingUser, PERMISSIONS.MANAGE_TECHNICIAN_PAYMENTS)) {
    return { error: "لا تملك صلاحية تسجيل المخالفات." };
  }

  if (!(await userExists(userId))) return { error: "المستخدم غير موجود." };

  const penaltyRuleId = emptyToUndefined(formData.get("penaltyRuleId"));
  const customDescription = emptyToUndefined(formData.get("customDescription"));
  const reason = emptyToUndefined(formData.get("reason"));
  const jobId = emptyToUndefined(formData.get("jobId"));
  const amountRaw = emptyToUndefined(formData.get("amount"));

  if (!reason) return { error: "سبب المخالفة مطلوب." };

  let rule: { id: string; label: string; defaultAmount: Money } | null = null;
  if (penaltyRuleId) {
    const [row] = await db.select().from(penaltyRules).where(eq(penaltyRules.id, penaltyRuleId)).limit(1);
    if (!row) return { error: "قاعدة المخالفة غير موجودة." };
    rule = row;
  }
  if (!rule && !customDescription) {
    return { error: "يجب اختيار نوع المخالفة أو إدخال وصف مخصص." };
  }

  let amount: Money;
  if (amountRaw) {
    const parsed = parseNonNegativeMoneyInput(amountRaw);
    if (parsed === null || !isPositive(parsed)) return { error: "المبلغ غير صحيح." };
    amount = parsed;
  } else if (rule) {
    amount = rule.defaultAmount;
  } else {
    return { error: "المبلغ مطلوب." };
  }

  if (jobId && !(await jobExists(jobId))) return { error: "المهمة غير موجودة." };

  const title = rule?.label ?? customDescription!;
  const description = `${title} — ${reason}`;

  let ledgerEntryId = "";
  await db.transaction(async (tx) => {
    const result = await writeLedgerEntry(tx, {
      userId,
      entryType: "penalty",
      amount: negateMoney(amount),
      penaltyRuleId: rule?.id,
      relatedJobId: jobId,
      description,
      createdByUserId: actingUser!.id,
      approvalStatus: "approved",
      approvedByUserId: actingUser!.id,
    });
    ledgerEntryId = result.id;

    await recordAudit(
      {
        userId: actingUser!.id,
        action: "technician_ledger_entry.record_penalty",
        entityType: "technician_ledger_entry",
        entityId: ledgerEntryId,
        newValue: { userId, jobId, amount, reason },
      },
      tx,
    );
  });

  await notifyUser({
    userId,
    type: "technician_penalty_recorded",
    title: "تم تسجيل مخالفة بحقك",
    body: description,
    relatedEntityType: "technician_ledger_entry",
    relatedEntityId: ledgerEntryId,
  });

  if (jobId) revalidatePath(`/jobs/${jobId}`);
  revalidatePath(`/technicians/${userId}`);
  return { success: true };
}

/**
 * A technician self-reports having received a payment from the company
 * (section 29) — no MANAGE_TECHNICIAN_PAYMENTS required, any logged-in
 * user may report on their own account only (userId is always the current
 * user, never a formData field). Auto-approved if the reporter already
 * holds MANAGE_TECHNICIAN_PAYMENTS themselves; otherwise queued for
 * approval, matching recordCustomerPayment's established pattern.
 */
export async function reportTechnicianPayment(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "يجب تسجيل الدخول." };

  const amount = parseNonNegativeMoneyInput(formData.get("amount"));
  if (amount === null || !isPositive(amount)) return { error: "المبلغ غير صحيح." };
  const note = emptyToUndefined(formData.get("note"));

  const autoApproved = can(user, PERMISSIONS.MANAGE_TECHNICIAN_PAYMENTS);

  let ledgerEntryId = "";
  await db.transaction(async (tx) => {
    const result = await writeLedgerEntry(tx, {
      userId: user.id,
      entryType: "payment_made",
      amount: negateMoney(amount),
      description: note,
      createdByUserId: user.id,
      approvalStatus: autoApproved ? "approved" : "pending",
      approvedByUserId: autoApproved ? user.id : undefined,
    });
    ledgerEntryId = result.id;

    if (!autoApproved) {
      await createApprovalRequest(tx, {
        entityType: "technician_ledger_entry",
        entityId: ledgerEntryId,
        requestedByUserId: user.id,
        summary: `${user.name} أبلغ عن استلام دفعة بمبلغ ${formatILS(amount)} من الشركة`,
        relatedJobId: null,
      });
    }

    await recordAudit(
      {
        userId: user.id,
        action: "technician_ledger_entry.report_payment",
        entityType: "technician_ledger_entry",
        entityId: ledgerEntryId,
        newValue: { amount, autoApproved },
      },
      tx,
    );
  });

  if (!autoApproved) {
    const approverIds = await getUserIdsWithPermission(PERMISSIONS.MANAGE_TECHNICIAN_PAYMENTS);
    await notifyUsers(approverIds, {
      type: "technician_payment_pending_approval",
      title: "دفعة فني بانتظار الاعتماد",
      relatedEntityType: "technician_ledger_entry",
      relatedEntityId: ledgerEntryId,
    });
  }

  revalidatePath(`/technicians/${user.id}`);
  return { success: true };
}

const DecideLedgerEntrySchema = z.object({
  decision: z.enum(["approve", "reject"]),
  rejectionReason: z.string().trim().optional(),
});

/**
 * Decides a pending technician ledger entry (currently only reachable for
 * entryType='payment_made', the one type reportTechnicianPayment can leave
 * pending) — the ONE place that flips technician_ledger_entries.approvalStatus,
 * race-safe exactly like decideCustomerPaymentAction in
 * src/server/approvals/decide.ts (conditional UPDATE ... WHERE
 * approval_status = 'pending', checked by affected row count).
 */
export async function decideTechnicianLedgerEntry(
  entryId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!can(user, PERMISSIONS.MANAGE_TECHNICIAN_PAYMENTS)) {
    return { error: "لا تملك صلاحية اعتماد مستحقات الفنيين." };
  }

  const parsed = DecideLedgerEntrySchema.safeParse({
    decision: formData.get("decision"),
    rejectionReason: emptyToUndefined(formData.get("rejectionReason")),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" };
  }

  const [entry] = await db
    .select()
    .from(technicianLedgerEntries)
    .where(eq(technicianLedgerEntries.id, entryId))
    .limit(1);
  if (!entry) return { error: "القيد غير موجود." };
  if (entry.approvalStatus !== "pending") {
    return { error: "تم اتخاذ قرار بشأن هذا القيد بالفعل." };
  }

  const [request] = await db
    .select()
    .from(approvalRequests)
    .where(
      and(
        eq(approvalRequests.entityType, "technician_ledger_entry"),
        eq(approvalRequests.entityId, entryId),
        eq(approvalRequests.status, "pending"),
      ),
    )
    .limit(1);

  const approved = parsed.data.decision === "approve";
  const now = new Date();

  // Race-safe against a double-decide exactly like decideCustomerPaymentAction:
  // the UPDATE only affects a row still 'pending', and its result tells us
  // whether we actually won that race.
  let alreadyDecided = false;

  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(technicianLedgerEntries)
      .set(
        approved
          ? { approvalStatus: "approved", approvedByUserId: user!.id, approvedAt: now }
          : { approvalStatus: "rejected" },
      )
      .where(
        and(
          eq(technicianLedgerEntries.id, entryId),
          eq(technicianLedgerEntries.approvalStatus, "pending"),
        ),
      )
      .returning({ id: technicianLedgerEntries.id });

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
        action: "technician_ledger_entry.decide",
        entityType: "technician_ledger_entry",
        entityId: entryId,
        newValue: { decision: parsed.data.decision },
      },
      tx,
    );
  });

  if (alreadyDecided) {
    return { error: "تم اتخاذ قرار بشأن هذا القيد بالفعل." };
  }

  if (entry.createdByUserId) {
    await notifyUser({
      userId: entry.createdByUserId,
      type: "technician_ledger_entry_decided",
      title: approved ? "تم اعتماد الدفعة المُبلَّغ عنها" : "تم رفض الدفعة المُبلَّغ عنها",
      relatedEntityType: "technician_ledger_entry",
      relatedEntityId: entryId,
    });
  }

  revalidatePath(`/technicians/${entry.userId}`);
  return { success: true };
}
