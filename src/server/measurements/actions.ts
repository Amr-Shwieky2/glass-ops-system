"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/server/db/client";
import type { Database } from "@/server/db/client";
import {
  jobs,
  jobStatuses,
  customers,
  measurements,
  measurementAttachments,
  glassTypes,
  userPermissions,
  users,
} from "@/server/db/schema";
import { getCurrentUser } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { PERMISSIONS, type PermissionKey } from "@/server/auth/permission-keys";
import { recordAudit } from "@/server/audit";
import { notifyUsers } from "@/server/notifications";
import { nextDocumentNumber } from "@/server/numbering";
import { isPlausiblePhone, normalizePhone } from "@/server/tokens";
import { parseNonNegativeMoneyInput } from "@/server/money";
import {
  MAX_ATTACHMENTS_PER_SUBMISSION,
  saveMeasurementAttachment,
  validateAttachmentFiles,
  type SavedAttachment,
} from "@/server/storage/attachments";

export interface ActionState {
  error?: string;
  success?: boolean;
}

/**
 * Every active user holding `permissionKey` — a small local helper rather
 * than a shared cross-module one, matching this codebase's existing
 * low-coupling convention (each domain's actions file owns the handful of
 * queries it needs; see e.g. how src/server/jobs/actions.ts doesn't import
 * a shared "list users" helper either). Used to broadcast the new field
 * submission to every possible pricer, per spec section 7 — nobody is
 * assigned as pricingResponsibleUserId at creation, so this is a fan-out
 * notification, not a single assignment.
 */
async function getUserIdsWithPermission(
  permissionKey: PermissionKey,
  executor: Database = db,
): Promise<string[]> {
  const rows = await executor
    .select({ userId: userPermissions.userId })
    .from(userPermissions)
    .innerJoin(users, eq(userPermissions.userId, users.id))
    .where(
      and(
        eq(userPermissions.permissionKey, permissionKey),
        eq(users.status, "active"),
        isNull(users.deletedAt),
      ),
    );
  return rows.map((r) => r.userId);
}

function emptyToUndefined(value: FormDataEntryValue | null): string | undefined {
  const s = typeof value === "string" ? value.trim() : "";
  return s.length > 0 ? s : undefined;
}

const FieldMeasurementSchema = z.object({
  phone: z.string().trim().min(1, { error: "رقم هاتف العميل مطلوب" }),
  customerName: z.string().trim().optional(),
  glassTypeId: z.string().uuid({ error: "نوع الزجاج غير صحيح" }).optional(),
  notes: z.string().trim().optional(),
  price: z.string().trim().optional(),
  priceIncludesVat: z.enum(["true", "false"]).optional(),
});

/**
 * New Measurement quick-submit flow (docs/superpowers/specs/
 * 2026-09-03-new-measurement-quick-submit-design.md) — a technician in the
 * field, with no prior office involvement, submits one form that creates a
 * customer (or reuses one), a job at `field_submission_pending`, a
 * measurement, and its attachments, all in one action. Gated on
 * CREATE_MEASUREMENT only (section 6) — creating the customer/job here is
 * a side effect of that one permission, not a separately-gated capability.
 *
 * Write ordering follows section 5 exactly: validate everything (fields,
 * then every file's type/size/count) before writing anything; write files
 * to disk first; only then run the DB transaction. If the transaction
 * fails after files were written, the orphaned files are harmless
 * (unreferenced, cleanable later) — the reverse order would risk a
 * measurement row pointing at files that don't exist, which is worse.
 *
 * Spec gap resolved here: section 5's storage path example is keyed by
 * `<measurement-id>`, but section 5's write-ordering also requires files
 * to be written BEFORE the transaction that creates that very row. Both
 * hold by generating the measurement's id up front (measurements.id has
 * no server-generated-only constraint — it's a plain uuid primary key) and
 * passing it explicitly to `.insert(measurements).values({ id: ... })`
 * inside the transaction, instead of letting the column's own
 * `defaultRandom()` pick it late.
 */
export async function submitFieldMeasurementAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!can(user, PERMISSIONS.CREATE_MEASUREMENT)) {
    return { error: "لا تملك صلاحية تسجيل القياسات." };
  }

  const parsed = FieldMeasurementSchema.safeParse({
    phone: formData.get("phone"),
    customerName: emptyToUndefined(formData.get("customerName")),
    glassTypeId: emptyToUndefined(formData.get("glassTypeId")),
    notes: emptyToUndefined(formData.get("notes")),
    price: emptyToUndefined(formData.get("price")),
    priceIncludesVat: emptyToUndefined(formData.get("priceIncludesVat")) as
      | "true"
      | "false"
      | undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" };
  }
  const data = parsed.data;

  const phone = normalizePhone(data.phone);
  if (!isPlausiblePhone(phone)) {
    return { error: "رقم هاتف العميل غير صحيح." };
  }

  let fieldQuotedPrice: string | null = null;
  let fieldQuotedPriceIncludesVat: boolean | null = null;
  if (data.price) {
    fieldQuotedPrice = parseNonNegativeMoneyInput(data.price);
    if (fieldQuotedPrice === null) {
      return { error: "السعر التقديري غير صحيح." };
    }
    if (data.priceIncludesVat === undefined) {
      return { error: "يرجى تحديد ما إذا كان السعر شامل الضريبة أم قبلها." };
    }
    fieldQuotedPriceIncludesVat = data.priceIncludesVat === "true";
  }

  if (data.glassTypeId) {
    const [glassType] = await db
      .select({ id: glassTypes.id })
      .from(glassTypes)
      .where(and(eq(glassTypes.id, data.glassTypeId), eq(glassTypes.isActive, true)))
      .limit(1);
    if (!glassType) {
      return { error: "نوع الزجاج غير صحيح." };
    }
  }

  const rawFiles = formData
    .getAll("files")
    .filter((f): f is File => f instanceof File && f.size > 0);
  if (rawFiles.length === 0) {
    return { error: "يجب إرفاق صورة واحدة على الأقل." };
  }
  if (rawFiles.length > MAX_ATTACHMENTS_PER_SUBMISSION) {
    return { error: `يمكن إرفاق ${MAX_ATTACHMENTS_PER_SUBMISSION} ملفات كحد أقصى.` };
  }
  const fileError = validateAttachmentFiles(rawFiles);
  if (fileError) {
    return { error: fileError };
  }

  // Files first (see the write-ordering note above), keyed by a measurement
  // id generated now so the path shape and the transaction ordering can
  // both hold.
  const measurementId = randomUUID();
  let savedFiles: SavedAttachment[];
  try {
    savedFiles = [];
    for (const file of rawFiles) {
      savedFiles.push(await saveMeasurementAttachment(measurementId, file));
    }
  } catch {
    return { error: "تعذر حفظ الملفات المرفقة، حاول مرة أخرى." };
  }

  let jobId: string;
  try {
    jobId = await db.transaction(async (tx) => {
      const existingCustomerRows = await tx
        .select({ id: customers.id })
        .from(customers)
        .where(and(eq(customers.phone, phone), isNull(customers.deletedAt)))
        .limit(1);

      let customerId = existingCustomerRows[0]?.id;
      if (!customerId) {
        // Atomic find-or-create: two near-simultaneous submissions for the
        // same phone (e.g. two technicians independently visiting the same
        // customer) can both reach this branch before either commits. The
        // partial unique index on customers.phone (schema/customers.ts,
        // WHERE deleted_at IS NULL) plus onConflictDoNothing makes the
        // loser's insert a no-op instead of creating a duplicate customer
        // row — Postgres blocks the loser on the winner's row lock until
        // the winner's transaction resolves, then re-checks the conflict,
        // so the immediate re-select below is guaranteed to see the
        // winner's committed row (or, if the winner rolled back, to find
        // nothing and fail loudly rather than silently duplicate).
        const [newCustomer] = await tx
          .insert(customers)
          .values({
            name: data.customerName || "عميل جديد",
            phone,
            createdByUserId: user!.id,
          })
          .onConflictDoNothing({
            target: customers.phone,
            where: isNull(customers.deletedAt),
          })
          .returning();

        if (newCustomer) {
          customerId = newCustomer.id;
          await recordAudit(
            {
              userId: user!.id,
              action: "customer.create",
              entityType: "customer",
              entityId: newCustomer.id,
              newValue: { name: newCustomer.name, phone: newCustomer.phone, source: "field_measurement" },
            },
            tx,
          );
        } else {
          const [raced] = await tx
            .select({ id: customers.id })
            .from(customers)
            .where(and(eq(customers.phone, phone), isNull(customers.deletedAt)))
            .limit(1);
          if (!raced) {
            throw new Error("تعذر تحديد عميل بهذا الرقم، حاول مرة أخرى.");
          }
          customerId = raced.id;
        }
      }

      const [pendingStatus] = await tx
        .select({ id: jobStatuses.id })
        .from(jobStatuses)
        .where(eq(jobStatuses.key, "field_submission_pending"))
        .limit(1);
      if (!pendingStatus) {
        throw new Error("تعذر تحديد حالة استلام القياس الميداني.");
      }

      const jobNumber = await nextDocumentNumber("job", tx);

      // pricingResponsibleUserId deliberately left unset (section 7) — this
      // is a broadcast to every CREATE_PRICE holder below, not an
      // assignment to one person.
      const [job] = await tx
        .insert(jobs)
        .values({
          jobNumber,
          customerId,
          statusId: pendingStatus.id,
          measuredByUserId: user!.id,
          createdByUserId: user!.id,
        })
        .returning();

      await recordAudit(
        {
          userId: user!.id,
          action: "job.create",
          entityType: "job",
          entityId: job.id,
          newValue: { jobNumber: job.jobNumber, customerId, source: "field_measurement" },
        },
        tx,
      );

      const hasImageAttachment = savedFiles.some((f) => f.mimeType.startsWith("image/"));

      await tx.insert(measurements).values({
        id: measurementId,
        jobId: job.id,
        measuredByUserId: user!.id,
        measuredAt: new Date(),
        details: data.notes,
        photosTaken: hasImageAttachment,
        glassTypeId: data.glassTypeId,
        fieldQuotedPrice,
        fieldQuotedPriceIncludesVat,
        source: "field_quick_submit",
      });

      await tx.insert(measurementAttachments).values(
        savedFiles.map((f) => ({
          measurementId,
          fileName: f.fileName,
          storagePath: f.storagePath,
          mimeType: f.mimeType,
          sizeBytes: f.sizeBytes,
          uploadedByUserId: user!.id,
        })),
      );

      await recordAudit(
        {
          userId: user!.id,
          action: "measurement.create",
          entityType: "job",
          entityId: job.id,
          newValue: { source: "field_measurement", attachmentCount: savedFiles.length },
        },
        tx,
      );

      return job.id;
    });
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "تعذر إرسال القياس، حاول مرة أخرى.",
    };
  }

  // After commit: broadcast to every CREATE_PRICE holder (section 7 — no
  // one is assigned yet, whoever acts on it first sets themselves
  // responsible the same way the existing pricing UI already lets any
  // CREATE_PRICE holder do today).
  const pricerIds = await getUserIdsWithPermission(PERMISSIONS.CREATE_PRICE);
  if (pricerIds.length > 0) {
    await notifyUsers(pricerIds, {
      type: "field_measurement_submitted",
      title: "قياس ميداني جديد بانتظار التسعير",
      body: "تم إرسال قياس ميداني جديد من الموقع وهو بانتظار التسعير.",
      relatedEntityType: "job",
      relatedEntityId: jobId,
    });
  }

  revalidatePath("/jobs");
  revalidatePath("/dashboard");
  revalidatePath(`/jobs/${jobId}`);
  redirect(`/jobs/${jobId}`);
}
