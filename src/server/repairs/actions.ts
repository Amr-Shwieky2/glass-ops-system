"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, count, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/server/db/client";
import { repairs, jobs, jobStatuses } from "@/server/db/schema";
import { getCurrentUser } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { PERMISSIONS } from "@/server/auth/permission-keys";
import { recordAudit } from "@/server/audit";
import { notifyUser } from "@/server/notifications";
import { advanceJobStatus } from "@/server/jobs/status";

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

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------------
// Create a repair / Tikun on a job (section 50). A repair with a
// scheduledDate starts life as 'scheduled' rather than 'open' — the visit
// is already booked, there's nothing left to "open". Either way it nudges
// the job's status to reflect the repair, safe to call on a job that's
// already moved further along (advanceJobStatus's sort-order guard is the
// only gate — it correctly no-ops rather than reopening a closed job).
// ---------------------------------------------------------------------
const CreateRepairSchema = z.object({
  problemDescription: z.string().trim().min(1, { error: "وصف المشكلة مطلوب" }),
  dateReported: z
    .string()
    .trim()
    .regex(DATE_RE, { error: "تاريخ الإبلاغ غير صحيح" })
    .optional(),
  responsibleUserId: z.string().uuid().optional(),
  scheduledDate: z
    .string()
    .trim()
    .regex(DATE_RE, { error: "تاريخ الموعد غير صحيح" })
    .optional(),
  notes: z.string().trim().optional(),
});

export async function createRepairAction(
  jobId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!can(user, PERMISSIONS.CREATE_REPAIR)) {
    return { error: "لا تملك صلاحية تسجيل إصلاح." };
  }

  const parsed = CreateRepairSchema.safeParse({
    problemDescription: formData.get("problemDescription"),
    dateReported: emptyToUndefined(formData.get("dateReported")),
    responsibleUserId: emptyToUndefined(formData.get("responsibleUserId")),
    scheduledDate: emptyToUndefined(formData.get("scheduledDate")),
    notes: emptyToUndefined(formData.get("notes")),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" };
  }

  const dateReported = parsed.data.dateReported ?? todayDateString();
  const status: "open" | "scheduled" = parsed.data.scheduledDate ? "scheduled" : "open";

  await db.transaction(async (tx) => {
    const [repair] = await tx
      .insert(repairs)
      .values({
        jobId,
        problemDescription: parsed.data.problemDescription,
        dateReported,
        responsibleUserId: parsed.data.responsibleUserId,
        scheduledDate: parsed.data.scheduledDate,
        status,
        notes: parsed.data.notes,
        createdByUserId: user!.id,
      })
      .returning({ id: repairs.id });

    await advanceJobStatus(
      tx,
      jobId,
      status === "scheduled" ? "repair_scheduled" : "repair_needed",
    );

    await recordAudit(
      {
        userId: user!.id,
        action: "repair.create",
        entityType: "repair",
        entityId: repair.id,
        newValue: { jobId, status, dateReported },
      },
      tx,
    );
  });

  if (parsed.data.responsibleUserId) {
    await notifyUser({
      userId: parsed.data.responsibleUserId,
      type: "repair_assigned",
      title: "تم تعيينك مسؤولاً عن إصلاح",
      relatedEntityType: "job",
      relatedEntityId: jobId,
    });
  }

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/repairs");
  revalidatePath("/dashboard");
  return { success: true };
}

// ---------------------------------------------------------------------
// Update a repair's status (section 50). Race-safe against a concurrent
// status change (double-click, two users) the same way every other
// pending/open -> decided transition in this codebase is: the UPDATE only
// affects a row still in the status we last observed it in, and its
// returned row count is the real guard.
//
// Resolving a repair (status -> 'resolved') sets resolvedAt and, ONLY if
// the job's CURRENT status is still exactly 'repair_needed' or
// 'repair_scheduled' (nothing else has moved it further along since),
// advances it back to 'installed' so the job stops describing itself by a
// now-resolved repair. If the job already moved past that through another
// path, its status is left untouched.
// ---------------------------------------------------------------------
const UpdateRepairStatusSchema = z.object({
  status: z.enum(["open", "scheduled", "in_progress", "resolved"], {
    error: "الحالة غير صحيحة",
  }),
  scheduledDate: z
    .string()
    .trim()
    .regex(DATE_RE, { error: "تاريخ الموعد غير صحيح" })
    .optional(),
});

export async function updateRepairStatusAction(
  repairId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!can(user, PERMISSIONS.CREATE_REPAIR)) {
    return { error: "لا تملك صلاحية تعديل حالة الإصلاح." };
  }

  const parsed = UpdateRepairStatusSchema.safeParse({
    status: formData.get("status"),
    scheduledDate: emptyToUndefined(formData.get("scheduledDate")),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" };
  }

  const [existing] = await db
    .select({ id: repairs.id, jobId: repairs.jobId, status: repairs.status })
    .from(repairs)
    .where(eq(repairs.id, repairId))
    .limit(1);
  if (!existing) return { error: "الإصلاح غير موجود." };

  const targetStatus = parsed.data.status;
  const now = new Date();
  let conflict = false;

  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(repairs)
      .set({
        status: targetStatus,
        scheduledDate:
          targetStatus === "scheduled" ? (parsed.data.scheduledDate ?? undefined) : undefined,
        resolvedAt: targetStatus === "resolved" ? now : undefined,
        updatedAt: now,
      })
      .where(and(eq(repairs.id, repairId), eq(repairs.status, existing.status)))
      .returning({ id: repairs.id });

    if (!updated) {
      conflict = true;
      return;
    }

    if (targetStatus === "resolved") {
      const [job] = await tx
        .select({ statusId: jobs.statusId, statusKey: jobStatuses.key })
        .from(jobs)
        .innerJoin(jobStatuses, eq(jobs.statusId, jobStatuses.id))
        .where(eq(jobs.id, existing.jobId))
        .limit(1);

      // Only reset the job's status if THIS was the last unresolved
      // repair on the job. Otherwise a job with two open repairs (one
      // that pushed it to repair_needed, another that's scheduled and
      // pushed it further to repair_scheduled) gets reset to "installed"
      // as soon as the first of the two is resolved, even though the
      // second is still open — mislabeling the job as done.
      const [{ value: otherOpenCount }] = await tx
        .select({ value: count() })
        .from(repairs)
        .where(
          and(
            eq(repairs.jobId, existing.jobId),
            ne(repairs.id, repairId),
            inArray(repairs.status, ["open", "scheduled", "in_progress"]),
          ),
        );

      if (
        job &&
        otherOpenCount === 0 &&
        (job.statusKey === "repair_needed" || job.statusKey === "repair_scheduled")
      ) {
        // NOT advanceJobStatus: "installed" sorts BEFORE repair_needed/
        // repair_scheduled (a post-installation repair is a forward step
        // past "installed"), so advanceJobStatus's forward-only guard
        // would silently refuse this move. Resolving the repair that put
        // the job into repair_needed/repair_scheduled is a deliberate,
        // explicit exception — go back to "installed" directly, still
        // race-safe via a conditional UPDATE against the exact status row
        // just observed in this same transaction.
        const [installedStatus] = await tx
          .select({ id: jobStatuses.id })
          .from(jobStatuses)
          .where(eq(jobStatuses.key, "installed"))
          .limit(1);
        if (installedStatus) {
          await tx
            .update(jobs)
            .set({ statusId: installedStatus.id, updatedAt: now })
            .where(and(eq(jobs.id, existing.jobId), eq(jobs.statusId, job.statusId)));
        }
      }
    }

    await recordAudit(
      {
        userId: user!.id,
        action: "repair.status_change",
        entityType: "repair",
        entityId: repairId,
        oldValue: { status: existing.status },
        newValue: { status: targetStatus },
      },
      tx,
    );
  });

  if (conflict) {
    return { error: "تم تعديل حالة هذا الإصلاح بالفعل من قبل مستخدم آخر." };
  }

  revalidatePath(`/jobs/${existing.jobId}`);
  revalidatePath("/repairs");
  revalidatePath("/dashboard");
  return { success: true };
}
