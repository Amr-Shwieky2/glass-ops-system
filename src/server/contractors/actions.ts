"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { externalContractors } from "@/server/db/schema";
import { getCurrentUser } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { PERMISSIONS } from "@/server/auth/permission-keys";
import { recordAudit } from "@/server/audit";

/**
 * Contractor create/edit/deactivate (Sprint 7, R1.31) — previously the
 * `external_contractors` table (schema/contractors.ts) had a real read
 * path (getActiveExternalContractors, assignToJob, addJobCostAction all
 * consume it) but no write path at all outside seed.ts; a contractor could
 * only ever exist by being hand-inserted into the demo data. Gated by
 * ASSIGN_INSTALLER — the same permission that already governs assigning a
 * contractor to a job/job-item (assign-dialog.tsx), the natural boundary
 * for "who manages the roster of contractors available to assign."
 */

export interface ActionState {
  error?: string;
  success?: boolean;
}

function emptyToUndefined(value: FormDataEntryValue | null): string | undefined {
  const s = typeof value === "string" ? value.trim() : "";
  return s.length > 0 ? s : undefined;
}

const ContractorSchema = z.object({
  name: z.string().trim().min(1, { error: "اسم المقاول مطلوب" }),
  phone: z.string().trim().optional(),
  serviceType: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});

export async function createContractorAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!can(user, PERMISSIONS.ASSIGN_INSTALLER)) {
    return { error: "لا تملك صلاحية إدارة المقاولين الخارجيين." };
  }

  const parsed = ContractorSchema.safeParse({
    name: formData.get("name"),
    phone: emptyToUndefined(formData.get("phone")),
    serviceType: emptyToUndefined(formData.get("serviceType")),
    notes: emptyToUndefined(formData.get("notes")),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" };
  }

  const [contractor] = await db
    .insert(externalContractors)
    .values({
      name: parsed.data.name,
      phone: parsed.data.phone,
      serviceType: parsed.data.serviceType,
      notes: parsed.data.notes,
    })
    .returning({ id: externalContractors.id });

  await recordAudit({
    userId: user!.id,
    action: "external_contractor.create",
    entityType: "external_contractor",
    entityId: contractor.id,
    newValue: { name: parsed.data.name, serviceType: parsed.data.serviceType },
  });

  revalidatePath("/contractors");
  return { success: true };
}

export async function updateContractorAction(
  contractorId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!can(user, PERMISSIONS.ASSIGN_INSTALLER)) {
    return { error: "لا تملك صلاحية إدارة المقاولين الخارجيين." };
  }

  const [existing] = await db
    .select({ id: externalContractors.id })
    .from(externalContractors)
    .where(eq(externalContractors.id, contractorId))
    .limit(1);
  if (!existing) return { error: "المقاول غير موجود." };

  const parsed = ContractorSchema.safeParse({
    name: formData.get("name"),
    phone: emptyToUndefined(formData.get("phone")),
    serviceType: emptyToUndefined(formData.get("serviceType")),
    notes: emptyToUndefined(formData.get("notes")),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" };
  }

  await db
    .update(externalContractors)
    .set({
      name: parsed.data.name,
      phone: parsed.data.phone,
      serviceType: parsed.data.serviceType,
      notes: parsed.data.notes,
    })
    .where(eq(externalContractors.id, contractorId));

  await recordAudit({
    userId: user!.id,
    action: "external_contractor.update",
    entityType: "external_contractor",
    entityId: contractorId,
    newValue: { name: parsed.data.name, serviceType: parsed.data.serviceType },
  });

  revalidatePath("/contractors");
  return { success: true };
}

/** Toggles isActive — never deletes a contractor row (job_assignments and
 * job_costs both reference it, restrict-on-delete would fail anyway once
 * a contractor has any history; an inactive contractor simply drops out of
 * getActiveExternalContractors' picker lists going forward). */
export async function setContractorActiveAction(
  contractorId: string,
  isActive: boolean,
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!can(user, PERMISSIONS.ASSIGN_INSTALLER)) {
    return { error: "لا تملك صلاحية إدارة المقاولين الخارجيين." };
  }

  const [existing] = await db
    .select({ id: externalContractors.id, isActive: externalContractors.isActive })
    .from(externalContractors)
    .where(eq(externalContractors.id, contractorId))
    .limit(1);
  if (!existing) return { error: "المقاول غير موجود." };

  await db
    .update(externalContractors)
    .set({ isActive })
    .where(eq(externalContractors.id, contractorId));

  await recordAudit({
    userId: user!.id,
    action: "external_contractor.set_active",
    entityType: "external_contractor",
    entityId: contractorId,
    oldValue: { isActive: existing.isActive },
    newValue: { isActive },
  });

  revalidatePath("/contractors");
  return { success: true };
}
