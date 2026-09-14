"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { appointments, appointmentAssignees, jobs, jobStatuses } from "@/server/db/schema";
import { getCurrentUser } from "@/server/auth/session";
import type { AuthedUser } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { PERMISSIONS, type PermissionKey } from "@/server/auth/permission-keys";
import { recordAudit } from "@/server/audit";
import { notifyUsers } from "@/server/notifications";
import { advanceJobStatus } from "@/server/jobs/status";
import { getAssigneeConflicts, isAppointmentAssignee } from "@/server/appointments/queries";
import { COMPANY_TIMEZONE } from "@/lib/company-day";
import { assertJobVisible } from "@/server/jobs/access";

export interface ActionState {
  error?: string;
  success?: boolean;
}

function emptyToUndefined(value: FormDataEntryValue | null): string | undefined {
  const s = typeof value === "string" ? value.trim() : "";
  return s.length > 0 ? s : undefined;
}

// ---------------------------------------------------------------------
// Schedule an appointment (section 40/41). The permission required, and
// whether it nudges the job's status forward, both depend on the
// appointment `type` — measurement/installation/repair each drive their
// own workflow stage; a customer_meeting/other appointment is just a
// calendar entry and only needs general job visibility.
// ---------------------------------------------------------------------
const APPOINTMENT_TYPE_PERMISSION: Record<string, PermissionKey> = {
  measurement: PERMISSIONS.CREATE_MEASUREMENT,
  installation: PERMISSIONS.ASSIGN_INSTALLER,
  repair: PERMISSIONS.CREATE_REPAIR,
  customer_meeting: PERMISSIONS.VIEW_ALL_JOBS,
  other: PERMISSIONS.VIEW_ALL_JOBS,
};

const APPOINTMENT_TYPE_TARGET_STATUS: Record<string, string | undefined> = {
  measurement: "measurement_scheduled",
  installation: "installation_scheduled",
  repair: "repair_scheduled",
};

const APPOINTMENT_TYPE_LABEL_AR: Record<string, string> = {
  measurement: "قياس",
  installation: "تركيب",
  repair: "إصلاح",
  customer_meeting: "اجتماع مع العميل",
  other: "موعد",
};

const ScheduleAppointmentSchema = z.object({
  type: z.enum([
    "measurement",
    "installation",
    "repair",
    "customer_meeting",
    "other",
  ]),
  scheduledStart: z.string().min(1, { error: "تاريخ ووقت البدء مطلوبان" }),
  scheduledEnd: z.string().trim().optional(),
  assigneeUserIds: z
    .array(z.string().uuid())
    .min(1, { error: "اختر مسؤولاً واحداً على الأقل" }),
  location: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});

export interface ScheduleAppointmentState extends ActionState {
  /** Non-blocking: set when one or more assignees already have another
   * scheduled appointment overlapping this time — the appointment is
   * still created, this is a heads-up toast, not a rejection. */
  warning?: string;
}

export async function scheduleAppointmentAction(
  jobId: string,
  _prevState: ScheduleAppointmentState,
  formData: FormData,
): Promise<ScheduleAppointmentState> {
  const user = await getCurrentUser();
  if (!user) return { error: "يجب تسجيل الدخول." };

  const parsed = ScheduleAppointmentSchema.safeParse({
    type: formData.get("type"),
    scheduledStart: formData.get("scheduledStart"),
    scheduledEnd: emptyToUndefined(formData.get("scheduledEnd")),
    assigneeUserIds: formData.getAll("assigneeUserIds"),
    location: emptyToUndefined(formData.get("location")),
    notes: emptyToUndefined(formData.get("notes")),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" };
  }
  const data = parsed.data;

  const requiredPermission = APPOINTMENT_TYPE_PERMISSION[data.type];
  if (!can(user, requiredPermission)) {
    return { error: "لا تملك صلاحية جدولة هذا النوع من المواعيد." };
  }
  // CREATE_MEASUREMENT/ASSIGN_INSTALLER/CREATE_REPAIR alone say nothing
  // about which jobs this caller may see — re-derive visibility rather
  // than trusting the client-supplied jobId (master execution prompt's
  // child-entity/job-scoped IDOR audit).
  const visErr = await assertJobVisible(user, jobId);
  if (visErr) return { error: visErr };

  const scheduledStart = new Date(data.scheduledStart);
  if (Number.isNaN(scheduledStart.getTime())) {
    return { error: "تاريخ ووقت البدء غير صحيحين" };
  }
  let scheduledEnd: Date | null = null;
  if (data.scheduledEnd) {
    scheduledEnd = new Date(data.scheduledEnd);
    if (Number.isNaN(scheduledEnd.getTime())) {
      return { error: "تاريخ ووقت الانتهاء غير صحيحين" };
    }
    if (scheduledEnd <= scheduledStart) {
      return { error: "يجب أن يكون وقت الانتهاء بعد وقت البدء" };
    }
  }

  const [job] = await db
    .select({
      id: jobs.id,
      jobNumber: jobs.jobNumber,
      isTerminal: jobStatuses.isTerminal,
    })
    .from(jobs)
    .innerJoin(jobStatuses, eq(jobs.statusId, jobStatuses.id))
    .where(eq(jobs.id, jobId))
    .limit(1);
  if (!job) return { error: "المهمة غير موجودة" };
  if (job.isTerminal) return { error: "لا يمكن جدولة موعد لمهمة مغلقة." };

  // Non-blocking conflict check — done before the write so the warning can
  // be returned alongside success, never as a reason to refuse the write.
  const conflictNames = await getAssigneeConflicts({
    userIds: data.assigneeUserIds,
    scheduledStart,
    scheduledEnd,
  });

  await db.transaction(async (tx) => {
    const [appointment] = await tx
      .insert(appointments)
      .values({
        jobId,
        type: data.type,
        scheduledStart,
        scheduledEnd,
        location: data.location,
        notes: data.notes,
        createdByUserId: user.id,
      })
      .returning();

    await tx.insert(appointmentAssignees).values(
      data.assigneeUserIds.map((userId) => ({
        appointmentId: appointment.id,
        userId,
      })),
    );

    const targetStatus = APPOINTMENT_TYPE_TARGET_STATUS[data.type];
    if (targetStatus) {
      await advanceJobStatus(tx, jobId, targetStatus);
    }

    await recordAudit(
      {
        userId: user.id,
        action: "appointment.schedule",
        entityType: "job",
        entityId: jobId,
        newValue: {
          appointmentId: appointment.id,
          type: data.type,
          scheduledStart,
          scheduledEnd,
          assigneeUserIds: data.assigneeUserIds,
        },
      },
      tx,
    );
  });

  const typeLabel = APPOINTMENT_TYPE_LABEL_AR[data.type];
  await notifyUsers(data.assigneeUserIds, {
    type: "appointment_scheduled",
    title: `تم جدولة موعد ${typeLabel} لمهمة ${job.jobNumber}`,
    relatedEntityType: "job",
    relatedEntityId: jobId,
  });

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/calendar");
  revalidatePath("/my-day");
  revalidatePath("/dashboard");

  const warning =
    conflictNames.length > 0
      ? `تعارض في الموعد لدى: ${conflictNames.join("، ")}`
      : undefined;

  return { success: true, warning };
}

// ---------------------------------------------------------------------
// Cancel an appointment — a removal, not a creation, so (mirroring
// removeAssignment in src/server/jobs/actions.ts) it is gated leniently:
// anyone who could have scheduled some kind of appointment can cancel one,
// rather than re-deriving the exact type-specific permission again.
// ---------------------------------------------------------------------
export async function cancelAppointmentAction(
  jobId: string,
  appointmentId: string,
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "يجب تسجيل الدخول." };

  // Never trust the caller-supplied jobId for the write itself — only the
  // appointment's OWN jobId (looked up here) is used below, matching the
  // ownership-check pattern the rest of this file uses (see
  // isAssignedToJob / isAppointmentAssignee). The parameter is only used
  // afterward, to revalidate the page the caller is presumably on.
  const [appointment] = await db
    .select({ id: appointments.id, jobId: appointments.jobId, status: appointments.status })
    .from(appointments)
    .where(eq(appointments.id, appointmentId))
    .limit(1);
  if (!appointment) return { error: "الموعد غير موجود." };

  // Being assigned to this specific appointment is always enough; failing
  // that, the caller needs genuine visibility into the appointment's REAL
  // job (VIEW_ALL_JOBS or independent involvement) — not merely SOME
  // scheduling-flavored permission, which previously let e.g. any
  // CREATE_MEASUREMENT holder cancel ANY appointment company-wide
  // regardless of which job it belonged to.
  const isAssignee = await isAppointmentAssignee(appointmentId, user.id);
  if (!isAssignee && (await assertJobVisible(user, appointment.jobId))) {
    return { error: "لا تملك صلاحية إلغاء هذا الموعد." };
  }

  let alreadyHandled = false;
  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(appointments)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(
        and(
          eq(appointments.id, appointmentId),
          inArray(appointments.status, ["scheduled", "arrived"]),
        ),
      )
      .returning({ id: appointments.id });

    if (!updated) {
      alreadyHandled = true;
      return;
    }

    await recordAudit(
      {
        userId: user.id,
        action: "appointment.cancel",
        entityType: "job",
        entityId: appointment.jobId,
        newValue: { appointmentId },
      },
      tx,
    );
  });

  if (alreadyHandled) {
    return { error: "تم التعامل مع هذا الموعد بالفعل." };
  }

  revalidatePath(`/jobs/${appointment.jobId}`);
  revalidatePath("/calendar");
  revalidatePath("/my-day");
  revalidatePath("/dashboard");
  return { success: true };
}

// ---------------------------------------------------------------------
// "وصلت الموقع" (My Day, technician-facing) — appointment-level bookkeeping
// only: it does NOT call advanceJobStatus, deliberately. The job pipeline
// tracks measurement/installation/repair scheduled -> done; "technician is
// physically on site" is a finer-grained signal than that pipeline models,
// so it stays confined to the appointment row.
// ---------------------------------------------------------------------

export async function markAppointmentArrivedAction(
  appointmentId: string,
  _prevState: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "يجب تسجيل الدخول." };

  const [appointment] = await db
    .select({ id: appointments.id, jobId: appointments.jobId })
    .from(appointments)
    .where(eq(appointments.id, appointmentId))
    .limit(1);
  if (!appointment) return { error: "الموعد غير موجود." };

  // "You can always act on what's assigned to you" (matches
  // completeInstallationAction's scoping via COMPLETE_INSTALLATION, here
  // applied directly against appointment_assignees since marking arrival
  // shouldn't require any broad admin permission) — OR genuine visibility
  // into the appointment's real job, for dispatchers/admins acting on
  // someone else's appointment (not merely holding some scheduling-
  // flavored permission unrelated to this specific job).
  const isAssignee = await isAppointmentAssignee(appointmentId, user.id);
  if (!isAssignee && (await assertJobVisible(user, appointment.jobId))) {
    return { error: "لا تملك صلاحية تحديث حالة هذا الموعد." };
  }

  const now = new Date();

  // Guards against a double-tap race: the UPDATE only affects an
  // appointment still 'scheduled', and its result tells us whether we
  // actually won that race — the plain SELECT above is just a fast-fail
  // for the common case, not the real guard (mirrors decideCustomerPaymentAction
  // in src/server/approvals/decide.ts and completeInstallationAction in
  // src/server/appointments/complete-installation.ts).
  let alreadyHandled = false;
  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(appointments)
      .set({ status: "arrived", arrivedAt: now, updatedAt: now })
      .where(and(eq(appointments.id, appointmentId), eq(appointments.status, "scheduled")))
      .returning({ id: appointments.id });

    if (!updated) {
      alreadyHandled = true;
      return;
    }

    await recordAudit(
      {
        userId: user.id,
        action: "appointment.arrive",
        entityType: "job",
        entityId: appointment.jobId,
        newValue: { appointmentId, arrivedAt: now },
      },
      tx,
    );
  });

  if (alreadyHandled) {
    return { error: "تم تحديث حالة هذا الموعد بالفعل — لا يمكن تكرار ذلك." };
  }

  revalidatePath(`/jobs/${appointment.jobId}`);
  revalidatePath("/my-day");
  revalidatePath("/calendar");
  return { success: true };
}

// ---------------------------------------------------------------------
// "رفع ملاحظة" (My Day, technician-facing) — a lightweight text-only field
// note appended to the job (section 5's `jobs.notes`). jobs.notes is a
// single freeform column with no other running-history mechanism, so a
// second technician's note must never be lost to a stale read-then-write
// (cancelJob in src/server/jobs/actions.ts appends its cancellation
// reason via this same pattern, rather than overwriting, for the same
// reason). Rather than stand up a new dedicated table for
// one field's worth of running history (real, but out of proportion to
// "one tap, minimal fields, doesn't lose prior notes"), this appends via a
// single atomic UPDATE ... SET notes = concat_ws(...) expression evaluated
// entirely inside Postgres — there is no intermediate SELECT-then-write of
// the notes value, so two people adding a note at the same instant can
// never clobber one another (concat_ws also quietly drops a NULL prior
// value, so the first note on a job needs no special-casing).
// ---------------------------------------------------------------------

const AddFieldNoteSchema = z.object({
  note: z.string().trim().min(1, { error: "نص الملاحظة مطلوب" }),
});

const fieldNoteTimestampFmt = new Intl.DateTimeFormat("ar", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  numberingSystem: "latn",
  timeZone: COMPANY_TIMEZONE,
});

function formatFieldNoteEntry(note: string, author: AuthedUser, at: Date): string {
  return `[${fieldNoteTimestampFmt.format(at)}] ${author.name}: ${note}`;
}

/** Whether `userId` is an assignee on any (non-cancelled or not) appointment
 * belonging to `jobId` — job-level, not appointment-level, since a field
 * note isn't tied to one specific visit. */
async function isAssignedToJob(jobId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ userId: appointmentAssignees.userId })
    .from(appointmentAssignees)
    .innerJoin(appointments, eq(appointmentAssignees.appointmentId, appointments.id))
    .where(and(eq(appointments.jobId, jobId), eq(appointmentAssignees.userId, userId)))
    .limit(1);
  return !!row;
}

export async function addFieldNoteAction(
  jobId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "يجب تسجيل الدخول." };

  const parsed = AddFieldNoteSchema.safeParse({ note: formData.get("note") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" };
  }

  const [job] = await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!job) return { error: "المهمة غير موجودة." };

  const assigned = await isAssignedToJob(jobId, user.id);
  if (!assigned && (await assertJobVisible(user, jobId))) {
    return { error: "لا تملك صلاحية إضافة ملاحظات على هذه المهمة." };
  }

  const now = new Date();
  const entry = formatFieldNoteEntry(parsed.data.note, user, now);

  await db.transaction(async (tx) => {
    await tx
      .update(jobs)
      .set({
        notes: sql`concat_ws(E'\n\n', ${jobs.notes}, ${entry}::text)`,
        updatedAt: now,
      })
      .where(eq(jobs.id, jobId));

    await recordAudit(
      {
        userId: user.id,
        action: "job.add_field_note",
        entityType: "job",
        entityId: jobId,
        newValue: { note: parsed.data.note },
      },
      tx,
    );
  });

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/my-day");
  return { success: true };
}
