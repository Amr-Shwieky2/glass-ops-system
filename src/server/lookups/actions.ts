"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { eq, count } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  jobStatuses,
  workTypes,
  compensationRules,
  penaltyRules,
  bonusRules,
  jobs,
  jobItems,
} from "@/server/db/schema";
import { getCurrentUser } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { PERMISSIONS } from "@/server/auth/permission-keys";
import { recordAudit } from "@/server/audit";
import { parseNonNegativeMoneyInput } from "@/server/money";

export interface ActionState {
  error?: string;
  success?: boolean;
}

/**
 * Extracts a Postgres error code from whatever drizzle-orm threw — mirrors
 * src/server/vehicles/actions.ts's pgErrorCode (drizzle-orm 0.45's
 * node-postgres driver wraps the real `pg` error in a DrizzleQueryError
 * with the original attached as `.cause`, so `err.code` alone can miss it).
 */
function pgErrorCode(err: unknown): string | undefined {
  const direct = (err as { code?: string } | null)?.code;
  if (direct) return direct;
  return (err as { cause?: { code?: string } } | null)?.cause?.code;
}

function emptyToUndefined(value: FormDataEntryValue | null): string | undefined {
  const s = typeof value === "string" ? value.trim() : "";
  return s.length > 0 ? s : undefined;
}

/** Parses a non-negative integer, e.g. a sortOrder field. */
function parseNonNegativeInt(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function requireManageSettings(
  user: Awaited<ReturnType<typeof getCurrentUser>>,
): string | null {
  if (!can(user, PERMISSIONS.MANAGE_SETTINGS)) {
    return "لا تملك صلاحية إدارة الإعدادات.";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Job statuses (section 13)
// ---------------------------------------------------------------------------

const CreateJobStatusSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1, { error: "المفتاح مطلوب" })
    .regex(/^[a-z][a-z0-9_]*$/, {
      error: "المفتاح يجب أن يبدأ بحرف إنجليزي صغير ويحتوي على أحرف صغيرة وأرقام وشرطة سفلية فقط",
    }),
  labelEn: z.string().trim().min(1, { error: "التسمية بالإنجليزية مطلوبة" }),
  labelAr: z.string().trim().min(1, { error: "التسمية بالعربية مطلوبة" }),
  sortOrder: z.string().trim().min(1, { error: "ترتيب العرض مطلوب" }),
  isTerminal: z.enum(["true", "false"]),
  color: z.string().trim().optional(),
});

/**
 * Creates a job status (section 13). `key` is the stable identifier jobs
 * reference by id (not by this string) but the string is still what other
 * server code matches against (e.g. advanceJobStatus's targetKey,
 * literals like "measurement_scheduled" / "installed" scattered through
 * earlier phases) — restricted to a safe identifier shape so a new status
 * can never collide with or be confused for one of those.
 */
export async function createJobStatusAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getCurrentUser();
  const permError = requireManageSettings(user);
  if (permError) return { error: permError };

  const parsed = CreateJobStatusSchema.safeParse({
    key: formData.get("key"),
    labelEn: formData.get("labelEn"),
    labelAr: formData.get("labelAr"),
    sortOrder: formData.get("sortOrder"),
    isTerminal: formData.get("isTerminal"),
    color: emptyToUndefined(formData.get("color")),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" };
  }

  const sortOrder = parseNonNegativeInt(parsed.data.sortOrder);
  if (sortOrder === null) {
    return { error: "ترتيب العرض يجب أن يكون رقماً صحيحاً غير سالب." };
  }
  const isTerminal = parsed.data.isTerminal === "true";

  try {
    await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(jobStatuses)
        .values({
          key: parsed.data.key,
          labelEn: parsed.data.labelEn,
          labelAr: parsed.data.labelAr,
          sortOrder,
          isTerminal,
          color: parsed.data.color ?? null,
        })
        .returning({ id: jobStatuses.id });

      await recordAudit(
        {
          userId: user!.id,
          action: "job_status.create",
          entityType: "job_status",
          entityId: row.id,
          newValue: { ...parsed.data, sortOrder, isTerminal },
        },
        tx,
      );
    });
  } catch (err: unknown) {
    if (pgErrorCode(err) === "23505") {
      return { error: "هذا المفتاح مستخدم بالفعل لحالة أخرى." };
    }
    return { error: "تعذر إنشاء الحالة، حاول مرة أخرى." };
  }

  revalidatePath("/settings");
  return { success: true };
}

const UpdateJobStatusSchema = z.object({
  labelEn: z.string().trim().min(1, { error: "التسمية بالإنجليزية مطلوبة" }),
  labelAr: z.string().trim().min(1, { error: "التسمية بالعربية مطلوبة" }),
  sortOrder: z.string().trim().min(1, { error: "ترتيب العرض مطلوب" }),
  color: z.string().trim().optional(),
  isActive: z.enum(["true", "false"]),
});

/**
 * Edits a job status's display fields (section 13). `key` and `isTerminal`
 * are DELIBERATELY not accepted here, even if a caller sends them:
 *
 *  - `key` is matched against by string literal throughout the codebase's
 *    own server code (advanceJobStatus callers pass targetKey strings like
 *    "measurement_scheduled" / "quote_signed" / "installed"; earlier
 *    phases' actions do the same) — renaming it here would silently break
 *    every one of those call sites with no compile-time signal.
 *  - `isTerminal` feeds the forward-only status-ordering logic
 *    (advanceJobStatus compares sortOrder, but a "terminal" status is
 *    relied on elsewhere as "this job is done, nothing moves it further")
 *    — flipping it after jobs already sit in this status would corrupt
 *    that logic's assumptions about which statuses are endpoints.
 *
 * Never hard-deletes a status — only isActive=false, and only when no job
 * currently sits in this status (checked as part of the same transaction
 * as the update, immediately before it, to keep the check-then-act race
 * window as small as this codebase's other in-use guards).
 */
export async function updateJobStatusAction(
  id: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getCurrentUser();
  const permError = requireManageSettings(user);
  if (permError) return { error: permError };

  const parsed = UpdateJobStatusSchema.safeParse({
    labelEn: formData.get("labelEn"),
    labelAr: formData.get("labelAr"),
    sortOrder: formData.get("sortOrder"),
    color: emptyToUndefined(formData.get("color")),
    isActive: formData.get("isActive"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" };
  }

  const sortOrder = parseNonNegativeInt(parsed.data.sortOrder);
  if (sortOrder === null) {
    return { error: "ترتيب العرض يجب أن يكون رقماً صحيحاً غير سالب." };
  }
  const isActive = parsed.data.isActive === "true";

  const [existing] = await db.select().from(jobStatuses).where(eq(jobStatuses.id, id)).limit(1);
  if (!existing) return { error: "الحالة غير موجودة." };

  let blockedByJobCount: number | null = null;

  try {
    await db.transaction(async (tx) => {
      if (!isActive && existing.isActive) {
        const [{ value: jobCount }] = await tx
          .select({ value: count() })
          .from(jobs)
          .where(eq(jobs.statusId, id));
        if (jobCount > 0) {
          blockedByJobCount = jobCount;
          return;
        }
      }

      await tx
        .update(jobStatuses)
        .set({
          labelEn: parsed.data.labelEn,
          labelAr: parsed.data.labelAr,
          sortOrder,
          color: parsed.data.color ?? null,
          isActive,
        })
        .where(eq(jobStatuses.id, id));

      await recordAudit(
        {
          userId: user!.id,
          action: "job_status.update",
          entityType: "job_status",
          entityId: id,
          oldValue: {
            labelEn: existing.labelEn,
            labelAr: existing.labelAr,
            sortOrder: existing.sortOrder,
            color: existing.color,
            isActive: existing.isActive,
          },
          newValue: {
            labelEn: parsed.data.labelEn,
            labelAr: parsed.data.labelAr,
            sortOrder,
            color: parsed.data.color ?? null,
            isActive,
          },
        },
        tx,
      );
    });
  } catch {
    return { error: "تعذر تحديث الحالة، حاول مرة أخرى." };
  }

  if (blockedByJobCount !== null) {
    return {
      error: `لا يمكن تعطيل هذه الحالة، ${blockedByJobCount} مهمة تستخدمها حالياً.`,
    };
  }

  revalidatePath("/settings");
  return { success: true };
}

// ---------------------------------------------------------------------------
// Work types (section 21/23)
// ---------------------------------------------------------------------------

const CreateWorkTypeSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1, { error: "المفتاح مطلوب" })
    .regex(/^[a-z][a-z0-9_]*$/, {
      error: "المفتاح يجب أن يبدأ بحرف إنجليزي صغير ويحتوي على أحرف صغيرة وأرقام وشرطة سفلية فقط",
    }),
  labelEn: z.string().trim().min(1, { error: "التسمية بالإنجليزية مطلوبة" }),
  labelAr: z.string().trim().min(1, { error: "التسمية بالعربية مطلوبة" }),
  defaultUnit: z.string().trim().min(1, { error: "الوحدة الافتراضية مطلوبة" }),
  sortOrder: z.string().trim().min(1, { error: "ترتيب العرض مطلوب" }),
});

/**
 * Creates a work type (section 21/23). `key` is referenced by literal
 * strings in seed data and possibly elsewhere — same reasoning as
 * job statuses above — so, again, it is not editable once created.
 */
export async function createWorkTypeAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getCurrentUser();
  const permError = requireManageSettings(user);
  if (permError) return { error: permError };

  const parsed = CreateWorkTypeSchema.safeParse({
    key: formData.get("key"),
    labelEn: formData.get("labelEn"),
    labelAr: formData.get("labelAr"),
    defaultUnit: formData.get("defaultUnit"),
    sortOrder: formData.get("sortOrder"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" };
  }

  const sortOrder = parseNonNegativeInt(parsed.data.sortOrder);
  if (sortOrder === null) {
    return { error: "ترتيب العرض يجب أن يكون رقماً صحيحاً غير سالب." };
  }

  try {
    await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(workTypes)
        .values({
          key: parsed.data.key,
          labelEn: parsed.data.labelEn,
          labelAr: parsed.data.labelAr,
          defaultUnit: parsed.data.defaultUnit,
          sortOrder,
        })
        .returning({ id: workTypes.id });

      await recordAudit(
        {
          userId: user!.id,
          action: "work_type.create",
          entityType: "work_type",
          entityId: row.id,
          newValue: { ...parsed.data, sortOrder },
        },
        tx,
      );
    });
  } catch (err: unknown) {
    if (pgErrorCode(err) === "23505") {
      return { error: "هذا المفتاح مستخدم بالفعل لنوع عمل آخر." };
    }
    return { error: "تعذر إنشاء نوع العمل، حاول مرة أخرى." };
  }

  revalidatePath("/settings");
  return { success: true };
}

const UpdateWorkTypeSchema = z.object({
  labelEn: z.string().trim().min(1, { error: "التسمية بالإنجليزية مطلوبة" }),
  labelAr: z.string().trim().min(1, { error: "التسمية بالعربية مطلوبة" }),
  defaultUnit: z.string().trim().min(1, { error: "الوحدة الافتراضية مطلوبة" }),
  sortOrder: z.string().trim().min(1, { error: "ترتيب العرض مطلوب" }),
  isActive: z.enum(["true", "false"]),
});

/**
 * Edits a work type's display fields (section 21/23). `key` is not
 * editable — see createWorkTypeAction's doc comment. Never hard-deletes —
 * only isActive=false, and only when no job_items or compensation_rules
 * row currently references this work type (checked inside the same
 * transaction as the update, immediately before it).
 */
export async function updateWorkTypeAction(
  id: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getCurrentUser();
  const permError = requireManageSettings(user);
  if (permError) return { error: permError };

  const parsed = UpdateWorkTypeSchema.safeParse({
    labelEn: formData.get("labelEn"),
    labelAr: formData.get("labelAr"),
    defaultUnit: formData.get("defaultUnit"),
    sortOrder: formData.get("sortOrder"),
    isActive: formData.get("isActive"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" };
  }

  const sortOrder = parseNonNegativeInt(parsed.data.sortOrder);
  if (sortOrder === null) {
    return { error: "ترتيب العرض يجب أن يكون رقماً صحيحاً غير سالب." };
  }
  const isActive = parsed.data.isActive === "true";

  const [existing] = await db.select().from(workTypes).where(eq(workTypes.id, id)).limit(1);
  if (!existing) return { error: "نوع العمل غير موجود." };

  let blockedByUsage: { itemCount: number; ruleCount: number } | null = null;

  try {
    await db.transaction(async (tx) => {
      if (!isActive && existing.isActive) {
        const [[{ value: itemCount }], [{ value: ruleCount }]] = await Promise.all([
          tx.select({ value: count() }).from(jobItems).where(eq(jobItems.workTypeId, id)),
          tx
            .select({ value: count() })
            .from(compensationRules)
            .where(eq(compensationRules.workTypeId, id)),
        ]);
        if (itemCount > 0 || ruleCount > 0) {
          blockedByUsage = { itemCount, ruleCount };
          return;
        }
      }

      await tx
        .update(workTypes)
        .set({
          labelEn: parsed.data.labelEn,
          labelAr: parsed.data.labelAr,
          defaultUnit: parsed.data.defaultUnit,
          sortOrder,
          isActive,
        })
        .where(eq(workTypes.id, id));

      await recordAudit(
        {
          userId: user!.id,
          action: "work_type.update",
          entityType: "work_type",
          entityId: id,
          oldValue: {
            labelEn: existing.labelEn,
            labelAr: existing.labelAr,
            defaultUnit: existing.defaultUnit,
            sortOrder: existing.sortOrder,
            isActive: existing.isActive,
          },
          newValue: {
            labelEn: parsed.data.labelEn,
            labelAr: parsed.data.labelAr,
            defaultUnit: parsed.data.defaultUnit,
            sortOrder,
            isActive,
          },
        },
        tx,
      );
    });
  } catch {
    return { error: "تعذر تحديث نوع العمل، حاول مرة أخرى." };
  }

  if (blockedByUsage !== null) {
    const { itemCount, ruleCount } = blockedByUsage as { itemCount: number; ruleCount: number };
    return {
      error: `لا يمكن تعطيل نوع العمل هذا، مستخدم في ${itemCount} بند مهمة و${ruleCount} قاعدة تعويض.`,
    };
  }

  revalidatePath("/settings");
  return { success: true };
}

// ---------------------------------------------------------------------------
// Compensation rules (section 23)
// ---------------------------------------------------------------------------

const COMPENSATION_UNITS = ["meter", "unit", "job", "day"] as const;

const CreateCompensationRuleSchema = z.object({
  label: z.string().trim().min(1, { error: "اسم القاعدة مطلوب" }),
  unit: z.enum(COMPENSATION_UNITS, { error: "الوحدة غير صحيحة" }),
  amount: z.string().trim().min(1, { error: "المبلغ مطلوب" }),
  workTypeId: z.uuid({ error: "نوع العمل غير صحيح" }).optional(),
});

/**
 * Creates an installer compensation rule (section 23). No "in use" guard
 * on deactivation is needed for this entity — see updateCompensationRuleAction's
 * doc comment: writeLedgerEntry (src/server/compensation/ledger.ts) always
 * snapshots `rateUsed` onto the ledger entry at the time it's earned, it
 * never re-reads the live rule, so deactivating a rule cannot retroactively
 * change a past ledger entry's amount.
 */
export async function createCompensationRuleAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getCurrentUser();
  const permError = requireManageSettings(user);
  if (permError) return { error: permError };

  const parsed = CreateCompensationRuleSchema.safeParse({
    label: formData.get("label"),
    unit: formData.get("unit"),
    amount: formData.get("amount"),
    workTypeId: emptyToUndefined(formData.get("workTypeId")),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" };
  }

  const amount = parseNonNegativeMoneyInput(parsed.data.amount);
  if (amount === null) return { error: "المبلغ غير صحيح." };

  if (parsed.data.workTypeId) {
    const [wt] = await db
      .select({ id: workTypes.id })
      .from(workTypes)
      .where(eq(workTypes.id, parsed.data.workTypeId))
      .limit(1);
    if (!wt) return { error: "نوع العمل غير موجود." };
  }

  await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(compensationRules)
      .values({
        label: parsed.data.label,
        unit: parsed.data.unit,
        amount,
        workTypeId: parsed.data.workTypeId,
      })
      .returning({ id: compensationRules.id });

    await recordAudit(
      {
        userId: user!.id,
        action: "compensation_rule.create",
        entityType: "compensation_rule",
        entityId: row.id,
        newValue: { ...parsed.data, amount },
      },
      tx,
    );
  });

  revalidatePath("/settings");
  return { success: true };
}

const UpdateCompensationRuleSchema = z.object({
  label: z.string().trim().min(1, { error: "اسم القاعدة مطلوب" }),
  unit: z.enum(COMPENSATION_UNITS, { error: "الوحدة غير صحيحة" }),
  amount: z.string().trim().min(1, { error: "المبلغ مطلوب" }),
  workTypeId: z.uuid({ error: "نوع العمل غير صحيح" }).optional(),
  isActive: z.enum(["true", "false"]),
});

/**
 * Edits (or deactivates) a compensation rule. Deactivate-only, no
 * hard delete — but unlike job statuses/work types, no "in use" guard is
 * needed: past technician_ledger_entries rows carry their own snapshotted
 * `rateUsed` (see writeLedgerEntry), so this rule going inactive changes
 * nothing about compensation already earned, only what a NEW installation
 * completion can select going forward.
 */
export async function updateCompensationRuleAction(
  id: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getCurrentUser();
  const permError = requireManageSettings(user);
  if (permError) return { error: permError };

  const parsed = UpdateCompensationRuleSchema.safeParse({
    label: formData.get("label"),
    unit: formData.get("unit"),
    amount: formData.get("amount"),
    workTypeId: emptyToUndefined(formData.get("workTypeId")),
    isActive: formData.get("isActive"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" };
  }

  const amount = parseNonNegativeMoneyInput(parsed.data.amount);
  if (amount === null) return { error: "المبلغ غير صحيح." };

  if (parsed.data.workTypeId) {
    const [wt] = await db
      .select({ id: workTypes.id })
      .from(workTypes)
      .where(eq(workTypes.id, parsed.data.workTypeId))
      .limit(1);
    if (!wt) return { error: "نوع العمل غير موجود." };
  }

  const [existing] = await db
    .select()
    .from(compensationRules)
    .where(eq(compensationRules.id, id))
    .limit(1);
  if (!existing) return { error: "قاعدة التعويض غير موجودة." };

  const isActive = parsed.data.isActive === "true";

  await db.transaction(async (tx) => {
    await tx
      .update(compensationRules)
      .set({
        label: parsed.data.label,
        unit: parsed.data.unit,
        amount,
        workTypeId: parsed.data.workTypeId ?? null,
        isActive,
        updatedAt: new Date(),
      })
      .where(eq(compensationRules.id, id));

    await recordAudit(
      {
        userId: user!.id,
        action: "compensation_rule.update",
        entityType: "compensation_rule",
        entityId: id,
        oldValue: {
          label: existing.label,
          unit: existing.unit,
          amount: existing.amount,
          workTypeId: existing.workTypeId,
          isActive: existing.isActive,
        },
        newValue: {
          label: parsed.data.label,
          unit: parsed.data.unit,
          amount,
          workTypeId: parsed.data.workTypeId ?? null,
          isActive,
        },
      },
      tx,
    );
  });

  revalidatePath("/settings");
  return { success: true };
}

// ---------------------------------------------------------------------------
// Penalty rules (section 30) / Bonus rules (section 31)
// ---------------------------------------------------------------------------

const CreatePenaltyOrBonusRuleSchema = z.object({
  label: z.string().trim().min(1, { error: "اسم القاعدة مطلوب" }),
  defaultAmount: z.string().trim().min(1, { error: "المبلغ الافتراضي مطلوب" }),
  description: z.string().trim().optional(),
});

const UpdatePenaltyOrBonusRuleSchema = CreatePenaltyOrBonusRuleSchema.extend({
  isActive: z.enum(["true", "false"]),
});

/**
 * Creates a penalty rule (section 30) — a reusable label/default amount a
 * technician penalty can be based on; the actual penalty ledger entry
 * (src/server/compensation/ledger.ts) stores its own amount independently,
 * same reasoning as compensation rules above, so no "in use" guard is
 * needed on deactivation.
 */
export async function createPenaltyRuleAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getCurrentUser();
  const permError = requireManageSettings(user);
  if (permError) return { error: permError };

  const parsed = CreatePenaltyOrBonusRuleSchema.safeParse({
    label: formData.get("label"),
    defaultAmount: formData.get("defaultAmount"),
    description: emptyToUndefined(formData.get("description")),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" };
  }

  const defaultAmount = parseNonNegativeMoneyInput(parsed.data.defaultAmount);
  if (defaultAmount === null) return { error: "المبلغ الافتراضي غير صحيح." };

  await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(penaltyRules)
      .values({
        label: parsed.data.label,
        defaultAmount,
        description: parsed.data.description ?? null,
      })
      .returning({ id: penaltyRules.id });

    await recordAudit(
      {
        userId: user!.id,
        action: "penalty_rule.create",
        entityType: "penalty_rule",
        entityId: row.id,
        newValue: { ...parsed.data, defaultAmount },
      },
      tx,
    );
  });

  revalidatePath("/settings");
  return { success: true };
}

/** Edits (or deactivates) a penalty rule. Deactivate-only, no hard delete. */
export async function updatePenaltyRuleAction(
  id: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getCurrentUser();
  const permError = requireManageSettings(user);
  if (permError) return { error: permError };

  const parsed = UpdatePenaltyOrBonusRuleSchema.safeParse({
    label: formData.get("label"),
    defaultAmount: formData.get("defaultAmount"),
    description: emptyToUndefined(formData.get("description")),
    isActive: formData.get("isActive"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" };
  }

  const defaultAmount = parseNonNegativeMoneyInput(parsed.data.defaultAmount);
  if (defaultAmount === null) return { error: "المبلغ الافتراضي غير صحيح." };

  const [existing] = await db.select().from(penaltyRules).where(eq(penaltyRules.id, id)).limit(1);
  if (!existing) return { error: "قاعدة الجزاء غير موجودة." };

  const isActive = parsed.data.isActive === "true";

  await db.transaction(async (tx) => {
    await tx
      .update(penaltyRules)
      .set({
        label: parsed.data.label,
        defaultAmount,
        description: parsed.data.description ?? null,
        isActive,
      })
      .where(eq(penaltyRules.id, id));

    await recordAudit(
      {
        userId: user!.id,
        action: "penalty_rule.update",
        entityType: "penalty_rule",
        entityId: id,
        oldValue: {
          label: existing.label,
          defaultAmount: existing.defaultAmount,
          description: existing.description,
          isActive: existing.isActive,
        },
        newValue: {
          label: parsed.data.label,
          defaultAmount,
          description: parsed.data.description ?? null,
          isActive,
        },
      },
      tx,
    );
  });

  revalidatePath("/settings");
  return { success: true };
}

/**
 * Creates a bonus rule (section 31). Same reasoning as penalty rules for
 * why no "in use" guard is needed on deactivation.
 */
export async function createBonusRuleAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getCurrentUser();
  const permError = requireManageSettings(user);
  if (permError) return { error: permError };

  const parsed = CreatePenaltyOrBonusRuleSchema.safeParse({
    label: formData.get("label"),
    defaultAmount: formData.get("defaultAmount"),
    description: emptyToUndefined(formData.get("description")),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" };
  }

  const defaultAmount = parseNonNegativeMoneyInput(parsed.data.defaultAmount);
  if (defaultAmount === null) return { error: "المبلغ الافتراضي غير صحيح." };

  await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(bonusRules)
      .values({
        label: parsed.data.label,
        defaultAmount,
        description: parsed.data.description ?? null,
      })
      .returning({ id: bonusRules.id });

    await recordAudit(
      {
        userId: user!.id,
        action: "bonus_rule.create",
        entityType: "bonus_rule",
        entityId: row.id,
        newValue: { ...parsed.data, defaultAmount },
      },
      tx,
    );
  });

  revalidatePath("/settings");
  return { success: true };
}

/** Edits (or deactivates) a bonus rule. Deactivate-only, no hard delete. */
export async function updateBonusRuleAction(
  id: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getCurrentUser();
  const permError = requireManageSettings(user);
  if (permError) return { error: permError };

  const parsed = UpdatePenaltyOrBonusRuleSchema.safeParse({
    label: formData.get("label"),
    defaultAmount: formData.get("defaultAmount"),
    description: emptyToUndefined(formData.get("description")),
    isActive: formData.get("isActive"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" };
  }

  const defaultAmount = parseNonNegativeMoneyInput(parsed.data.defaultAmount);
  if (defaultAmount === null) return { error: "المبلغ الافتراضي غير صحيح." };

  const [existing] = await db.select().from(bonusRules).where(eq(bonusRules.id, id)).limit(1);
  if (!existing) return { error: "قاعدة المكافأة غير موجودة." };

  const isActive = parsed.data.isActive === "true";

  await db.transaction(async (tx) => {
    await tx
      .update(bonusRules)
      .set({
        label: parsed.data.label,
        defaultAmount,
        description: parsed.data.description ?? null,
        isActive,
      })
      .where(eq(bonusRules.id, id));

    await recordAudit(
      {
        userId: user!.id,
        action: "bonus_rule.update",
        entityType: "bonus_rule",
        entityId: id,
        oldValue: {
          label: existing.label,
          defaultAmount: existing.defaultAmount,
          description: existing.description,
          isActive: existing.isActive,
        },
        newValue: {
          label: parsed.data.label,
          defaultAmount,
          description: parsed.data.description ?? null,
          isActive,
        },
      },
      tx,
    );
  });

  revalidatePath("/settings");
  return { success: true };
}
