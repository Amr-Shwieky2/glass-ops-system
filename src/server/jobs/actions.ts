"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  jobs,
  jobItems,
  jobAssignments,
  measurements,
  customers,
  jobStatuses,
} from "@/server/db/schema";
import { getCurrentUser } from "@/server/auth/session";
import { can, canAny } from "@/server/auth/permissions";
import { PERMISSIONS } from "@/server/auth/permission-keys";
import { recordAudit } from "@/server/audit";
import { notifyUser } from "@/server/notifications";
import { nextDocumentNumber } from "@/server/numbering";
import { isPlausiblePhone, normalizePhone } from "@/server/tokens";
import { parseNonNegativeMoneyInput } from "@/server/money";
import { COMPANY_TIMEZONE } from "@/lib/company-day";

export interface ActionState {
  error?: string;
  success?: boolean;
}

// ---------------------------------------------------------------------
// Create job (new lead). Either an existing customerId is supplied, or a
// brand-new customer's name+phone are — never both, the form toggles.
// ---------------------------------------------------------------------
const CreateJobSchema = z.object({
  customerId: z.string().uuid().optional(),
  newCustomerName: z.string().trim().optional(),
  newCustomerPhone: z.string().trim().optional(),
  title: z.string().trim().optional(),
  address: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});

function emptyToUndefined(value: FormDataEntryValue | null): string | undefined {
  const s = typeof value === "string" ? value.trim() : "";
  return s.length > 0 ? s : undefined;
}

export async function createJob(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "يجب تسجيل الدخول." };
  // Creating a lead/job requires being able to at least manage customers or
  // jobs in some capacity; the narrowest real gate available is being able
  // to view all jobs (a pure installer with only VIEW_ASSIGNED_JOBS should
  // not be spinning up new leads).
  if (!canAny(user, [PERMISSIONS.VIEW_ALL_JOBS, PERMISSIONS.CREATE_CUSTOMER])) {
    return { error: "لا تملك صلاحية إنشاء مهام جديدة." };
  }

  const parsed = CreateJobSchema.safeParse({
    customerId: emptyToUndefined(formData.get("customerId")),
    newCustomerName: emptyToUndefined(formData.get("newCustomerName")),
    newCustomerPhone: emptyToUndefined(formData.get("newCustomerPhone")),
    title: emptyToUndefined(formData.get("title")),
    address: emptyToUndefined(formData.get("address")),
    notes: emptyToUndefined(formData.get("notes")),
  });
  if (!parsed.success) {
    return { error: "بيانات غير صحيحة" };
  }
  const data = parsed.data;

  if (!data.customerId && !(data.newCustomerName && data.newCustomerPhone)) {
    return { error: "اختر عميلاً موجوداً أو أدخل اسم ورقم هاتف عميل جديد" };
  }

  let jobId: string;
  try {
    jobId = await db.transaction(async (tx) => {
      let customerId = data.customerId;
      let customerAddress: string | null = null;

      if (!customerId) {
        const phone = normalizePhone(data.newCustomerPhone!);
        if (!isPlausiblePhone(phone)) {
          throw new Error("رقم هاتف العميل الجديد غير صحيح");
        }
        const [newCustomer] = await tx
          .insert(customers)
          .values({
            name: data.newCustomerName!,
            phone,
            createdByUserId: user.id,
          })
          .returning();
        customerId = newCustomer.id;
        await recordAudit(
          {
            userId: user.id,
            action: "customer.create",
            entityType: "customer",
            entityId: newCustomer.id,
            newValue: { name: newCustomer.name, phone: newCustomer.phone },
          },
          tx,
        );
      } else {
        const rows = await tx
          .select({ address: customers.address })
          .from(customers)
          .where(eq(customers.id, customerId))
          .limit(1);
        customerAddress = rows[0]?.address ?? null;
      }

      const [newLeadStatus] = await tx
        .select({ id: jobStatuses.id })
        .from(jobStatuses)
        .where(eq(jobStatuses.key, "new_lead"))
        .limit(1);
      if (!newLeadStatus) throw new Error("تعذر تحديد حالة المهمة الابتدائية");

      const jobNumber = await nextDocumentNumber("job", tx);

      const [job] = await tx
        .insert(jobs)
        .values({
          jobNumber,
          customerId,
          statusId: newLeadStatus.id,
          title: data.title,
          address: data.address ?? customerAddress ?? undefined,
          notes: data.notes,
          createdByUserId: user.id,
        })
        .returning();

      await recordAudit(
        {
          userId: user.id,
          action: "job.create",
          entityType: "job",
          entityId: job.id,
          newValue: { jobNumber: job.jobNumber, customerId },
        },
        tx,
      );

      return job.id;
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "تعذر إنشاء المهمة" };
  }

  revalidatePath("/jobs");
  revalidatePath("/dashboard");
  redirect(`/jobs/${jobId}`);
}

// ---------------------------------------------------------------------
// Measurements
// ---------------------------------------------------------------------
const MeasurementSchema = z.object({
  measuredAt: z.string().min(1, { error: "التاريخ والوقت مطلوبان" }),
  details: z.string().trim().optional(),
  photosTaken: z.boolean(),
  pricingResponsibleUserId: z.string().uuid().optional(),
});

export async function createMeasurement(
  jobId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!can(user, PERMISSIONS.CREATE_MEASUREMENT)) {
    return { error: "لا تملك صلاحية تسجيل القياسات." };
  }

  const parsed = MeasurementSchema.safeParse({
    measuredAt: formData.get("measuredAt"),
    details: emptyToUndefined(formData.get("details")),
    photosTaken: formData.get("photosTaken") === "on",
    pricingResponsibleUserId: emptyToUndefined(
      formData.get("pricingResponsibleUserId"),
    ),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" };
  }

  const measuredAt = new Date(parsed.data.measuredAt);
  if (Number.isNaN(measuredAt.getTime())) {
    return { error: "تاريخ غير صحيح" };
  }

  await db.transaction(async (tx) => {
    await tx.insert(measurements).values({
      jobId,
      measuredByUserId: user!.id,
      measuredAt,
      details: parsed.data.details,
      photosTaken: parsed.data.photosTaken,
      pricingResponsibleUserId: parsed.data.pricingResponsibleUserId,
    });

    // Move the job forward: a measurement was just recorded, so it's no
    // longer just a lead — it's ready to be priced. Only nudges the status
    // if the job hasn't already moved further along (e.g. re-measuring a
    // job that's already been quoted shouldn't roll it backwards).
    const [current] = await tx
      .select({ statusKey: jobStatuses.key })
      .from(jobs)
      .innerJoin(jobStatuses, eq(jobs.statusId, jobStatuses.id))
      .where(eq(jobs.id, jobId))
      .limit(1);

    if (
      current &&
      (current.statusKey === "new_lead" ||
        current.statusKey === "measurement_scheduled")
    ) {
      const [nextStatus] = await tx
        .select({ id: jobStatuses.id })
        .from(jobStatuses)
        .where(eq(jobStatuses.key, "measurement_completed"))
        .limit(1);
      if (nextStatus) {
        await tx
          .update(jobs)
          .set({ statusId: nextStatus.id, updatedAt: new Date() })
          .where(eq(jobs.id, jobId));
      }
    }

    await tx
      .update(jobs)
      .set({
        measuredByUserId: user!.id,
        pricingResponsibleUserId:
          parsed.data.pricingResponsibleUserId ?? undefined,
      })
      .where(eq(jobs.id, jobId));

    await recordAudit(
      {
        userId: user!.id,
        action: "measurement.create",
        entityType: "job",
        entityId: jobId,
      },
      tx,
    );

    if (parsed.data.pricingResponsibleUserId) {
      await notifyUser(
        {
          userId: parsed.data.pricingResponsibleUserId,
          type: "measurement_ready_for_pricing",
          title: "قياس جاهز للتسعير",
          body: "تم تسجيل قياس لمهمة وهي بانتظار التسعير.",
          relatedEntityType: "job",
          relatedEntityId: jobId,
        },
        tx,
      );
    }
  });

  revalidatePath(`/jobs/${jobId}`);
  return { success: true };
}

// ---------------------------------------------------------------------
// Job items (work lines)
// ---------------------------------------------------------------------
const JobItemSchema = z.object({
  workTypeId: z.string().uuid().optional(),
  description: z.string().trim().optional(),
  quantity: z.string().trim().optional(),
  unit: z.string().trim().optional(),
  salePrice: z.string().trim().optional(),
  expectedCost: z.string().trim().optional(),
});

export async function addJobItem(
  jobId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!canAny(user, [PERMISSIONS.CREATE_PRICE, PERMISSIONS.EDIT_PRICE])) {
    return { error: "لا تملك صلاحية إضافة بنود التسعير." };
  }

  const parsed = JobItemSchema.safeParse({
    workTypeId: emptyToUndefined(formData.get("workTypeId")),
    description: emptyToUndefined(formData.get("description")),
    quantity: emptyToUndefined(formData.get("quantity")),
    unit: emptyToUndefined(formData.get("unit")),
    salePrice: emptyToUndefined(formData.get("salePrice")),
    expectedCost: emptyToUndefined(formData.get("expectedCost")),
  });
  if (!parsed.success) return { error: "بيانات غير صحيحة" };

  let salePrice: string | null = null;
  if (parsed.data.salePrice) {
    salePrice = parseNonNegativeMoneyInput(parsed.data.salePrice);
    if (salePrice === null) return { error: "سعر البيع غير صحيح" };
  }
  let expectedCost: string | null = null;
  if (parsed.data.expectedCost) {
    expectedCost = parseNonNegativeMoneyInput(parsed.data.expectedCost);
    if (expectedCost === null) return { error: "التكلفة المتوقعة غير صحيحة" };
  }

  await db.insert(jobItems).values({
    jobId,
    workTypeId: parsed.data.workTypeId,
    description: parsed.data.description,
    quantity: parsed.data.quantity || "1",
    unit: parsed.data.unit,
    salePrice,
    expectedCost,
  });

  await recordAudit({
    userId: user!.id,
    action: "job_item.create",
    entityType: "job",
    entityId: jobId,
  });

  revalidatePath(`/jobs/${jobId}`);
  return { success: true };
}

export async function deleteJobItem(
  jobId: string,
  jobItemId: string,
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!canAny(user, [PERMISSIONS.CREATE_PRICE, PERMISSIONS.EDIT_PRICE])) {
    return { error: "لا تملك صلاحية حذف بنود التسعير." };
  }
  await db.delete(jobItems).where(eq(jobItems.id, jobItemId));
  await recordAudit({
    userId: user!.id,
    action: "job_item.delete",
    entityType: "job",
    entityId: jobId,
  });
  revalidatePath(`/jobs/${jobId}`);
  return { success: true };
}

// ---------------------------------------------------------------------
// Assignments
// ---------------------------------------------------------------------
const AssignmentSchema = z.object({
  userId: z.string().uuid().optional(),
  externalContractorId: z.string().uuid().optional(),
  role: z.string().trim().optional(),
});

export async function assignToJob(
  jobId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!can(user, PERMISSIONS.ASSIGN_INSTALLER)) {
    return { error: "لا تملك صلاحية تعيين فنيين." };
  }

  const parsed = AssignmentSchema.safeParse({
    userId: emptyToUndefined(formData.get("userId")),
    externalContractorId: emptyToUndefined(
      formData.get("externalContractorId"),
    ),
    role: emptyToUndefined(formData.get("role")),
  });
  if (!parsed.success) return { error: "بيانات غير صحيحة" };
  if (!parsed.data.userId && !parsed.data.externalContractorId) {
    return { error: "اختر فنياً أو مقاولاً خارجياً" };
  }

  await db.insert(jobAssignments).values({
    jobId,
    userId: parsed.data.userId,
    externalContractorId: parsed.data.externalContractorId,
    role: parsed.data.role,
    createdByUserId: user!.id,
  });

  await recordAudit({
    userId: user!.id,
    action: "job_assignment.create",
    entityType: "job",
    entityId: jobId,
  });

  if (parsed.data.userId) {
    await notifyUser({
      userId: parsed.data.userId,
      type: "job_assigned",
      title: "تم تعيينك على مهمة جديدة",
      relatedEntityType: "job",
      relatedEntityId: jobId,
    });
  }

  revalidatePath(`/jobs/${jobId}`);
  return { success: true };
}

export async function removeAssignment(
  jobId: string,
  assignmentId: string,
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!can(user, PERMISSIONS.ASSIGN_INSTALLER)) {
    return { error: "لا تملك صلاحية إزالة التعيينات." };
  }
  await db.delete(jobAssignments).where(eq(jobAssignments.id, assignmentId));
  await recordAudit({
    userId: user!.id,
    action: "job_assignment.remove",
    entityType: "job",
    entityId: jobId,
  });
  revalidatePath(`/jobs/${jobId}`);
  return { success: true };
}

const cancelNoteTimestampFmt = new Intl.DateTimeFormat("ar", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  numberingSystem: "latn",
  timeZone: COMPANY_TIMEZONE,
});

// ---------------------------------------------------------------------
// Cancel job — the one manual status transition exposed directly, gated
// tightly; every other status change is a side effect of a real workflow
// action (measure/quote/produce/install), never a free-form dropdown.
//
// The cancellation reason is APPENDED to jobs.notes (same atomic
// concat_ws pattern as addFieldNoteAction in
// src/server/appointments/actions.ts), never a wholesale overwrite — a
// prior cancelJob revision blindly set notes: reason, which silently
// destroyed every timestamped field note a technician had logged for the
// job the instant it was cancelled. jobs.notes is a single freeform
// column with no other running-history mechanism, so preserving prior
// content here is the only way that history survives.
// ---------------------------------------------------------------------
export async function cancelJob(
  jobId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!can(user, PERMISSIONS.CLOSE_DEAL)) {
    return { error: "لا تملك صلاحية إلغاء المهام." };
  }
  const reason = emptyToUndefined(formData.get("reason"));

  const [cancelledStatus] = await db
    .select({ id: jobStatuses.id })
    .from(jobStatuses)
    .where(eq(jobStatuses.key, "cancelled"))
    .limit(1);
  if (!cancelledStatus) return { error: "تعذر تحديد حالة الإلغاء" };

  const now = new Date();
  const cancelEntry = reason
    ? `[${cancelNoteTimestampFmt.format(now)}] ${user!.name} (إلغاء المهمة): ${reason}`
    : undefined;

  await db
    .update(jobs)
    .set({
      statusId: cancelledStatus.id,
      ...(cancelEntry
        ? { notes: sql`concat_ws(E'\n\n', ${jobs.notes}, ${cancelEntry}::text)` }
        : {}),
      closedAt: now,
      updatedAt: now,
    })
    .where(eq(jobs.id, jobId));

  await recordAudit({
    userId: user!.id,
    action: "job.cancel",
    entityType: "job",
    entityId: jobId,
    newValue: { reason },
  });

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/jobs");
  return { success: true };
}
