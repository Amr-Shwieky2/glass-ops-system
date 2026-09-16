"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { vehicles, vehicleMaintenanceCosts } from "@/server/db/schema";
import { getCurrentUser } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { PERMISSIONS } from "@/server/auth/permission-keys";
import { recordAudit } from "@/server/audit";
import { parseNonNegativeMoneyInput, isPositive } from "@/server/money";
import { getTodayDateString } from "@/lib/company-day";

export interface ActionState {
  error?: string;
  success?: boolean;
}

function emptyToUndefined(value: FormDataEntryValue | null): string | undefined {
  const s = typeof value === "string" ? value.trim() : "";
  return s.length > 0 ? s : undefined;
}

const MAINTENANCE_CATEGORIES = ["maintenance", "insurance", "registration", "tires", "other"] as const;

const RecordMaintenanceCostSchema = z.object({
  vehicleId: z.uuid({ error: "المركبة مطلوبة" }),
  category: z.enum(MAINTENANCE_CATEGORIES, { error: "نوع التكلفة غير صحيح" }),
  amount: z.string().trim().min(1, { error: "المبلغ مطلوب" }),
  description: z.string().trim().min(1, { error: "الوصف مطلوب" }),
  incurredAt: z.string().trim().optional(),
});

/**
 * Records a non-fuel vehicle operating cost (Sprint 7, S7.6) —
 * maintenance, insurance, registration, tires, or other. Gated by
 * MANAGE_VEHICLES, the same permission that already governs creating/
 * editing a vehicle and assigning its responsibility — the natural
 * management boundary, distinct from ADD_FUEL (any driver can log fuel
 * they bought, but recording a maintenance/insurance cost is a management
 * bookkeeping action).
 */
export async function recordMaintenanceCostAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!can(user, PERMISSIONS.MANAGE_VEHICLES)) {
    return { error: "لا تملك صلاحية تسجيل تكاليف المركبات." };
  }

  const parsed = RecordMaintenanceCostSchema.safeParse({
    vehicleId: formData.get("vehicleId"),
    category: formData.get("category"),
    amount: formData.get("amount"),
    description: formData.get("description"),
    incurredAt: emptyToUndefined(formData.get("incurredAt")),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" };
  }

  const amount = parseNonNegativeMoneyInput(parsed.data.amount);
  if (amount === null || !isPositive(amount)) {
    return { error: "المبلغ غير صحيح" };
  }

  const [vehicle] = await db
    .select({ id: vehicles.id })
    .from(vehicles)
    .where(eq(vehicles.id, parsed.data.vehicleId))
    .limit(1);
  if (!vehicle) return { error: "المركبة غير موجودة." };

  const incurredAt = parsed.data.incurredAt || getTodayDateString();

  await db.transaction(async (tx) => {
    const [cost] = await tx
      .insert(vehicleMaintenanceCosts)
      .values({
        vehicleId: parsed.data.vehicleId,
        amount,
        category: parsed.data.category,
        description: parsed.data.description,
        incurredAt,
        addedByUserId: user!.id,
      })
      .returning({ id: vehicleMaintenanceCosts.id });

    await recordAudit(
      {
        userId: user!.id,
        action: "vehicle_maintenance_cost.create",
        entityType: "vehicle_maintenance_cost",
        entityId: cost.id,
        newValue: { vehicleId: parsed.data.vehicleId, amount, category: parsed.data.category },
      },
      tx,
    );
  });

  revalidatePath(`/vehicles/${parsed.data.vehicleId}`);
  return { success: true };
}
