"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { vehicles, fuelLogs } from "@/server/db/schema";
import { getCurrentUser } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { PERMISSIONS } from "@/server/auth/permission-keys";
import { recordAudit } from "@/server/audit";
import { parseNonNegativeMoneyInput, isPositive } from "@/server/money";

export interface ActionState {
  error?: string;
  success?: boolean;
}

function emptyToUndefined(value: FormDataEntryValue | null): string | undefined {
  const s = typeof value === "string" ? value.trim() : "";
  return s.length > 0 ? s : undefined;
}

const FUEL_TYPES = ["petrol", "diesel", "electric", "hybrid", "other"] as const;

const AddFuelSchema = z.object({
  vehicleId: z.uuid({ error: "المركبة مطلوبة" }),
  fuelType: z.enum(FUEL_TYPES, { error: "نوع الوقود غير صحيح" }),
  amount: z.string().trim().min(1, { error: "المبلغ مطلوب" }),
  liters: z.string().trim().optional(),
  mileage: z.string().trim().optional(),
  receiptPhotoTaken: z.enum(["true", "false"]).optional(),
  notes: z.string().trim().optional(),
});

/**
 * Logs a fuel purchase (section 56) — the minimum-input fast-entry form:
 * Vehicle, Fuel Type and Amount are the only required fields, everything
 * else (liters/mileage/receipt/notes) is genuinely optional. addedByUserId
 * and loggedAt are never asked for — always the current user, now — per
 * "Automatically record: User, Date, Time".
 *
 * No job_cost/ledger entry is created here. Linking fuel to a specific
 * job's cost ledger is an explicitly optional LATER extension (section 46,
 * "Fuel directly related to job if enabled") — jobCostCategoryEnum already
 * reserves a 'fuel' value for it, but nothing wires it up, deliberately,
 * out of this phase's core scope.
 */
export async function addFuelAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!can(user, PERMISSIONS.ADD_FUEL)) {
    return { error: "لا تملك صلاحية تسجيل الوقود." };
  }

  const parsed = AddFuelSchema.safeParse({
    vehicleId: formData.get("vehicleId"),
    fuelType: formData.get("fuelType"),
    amount: formData.get("amount"),
    liters: emptyToUndefined(formData.get("liters")),
    mileage: emptyToUndefined(formData.get("mileage")),
    receiptPhotoTaken: emptyToUndefined(formData.get("receiptPhotoTaken")),
    notes: emptyToUndefined(formData.get("notes")),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" };
  }

  const amount = parseNonNegativeMoneyInput(parsed.data.amount);
  if (amount === null || !isPositive(amount)) {
    return { error: "المبلغ غير صحيح" };
  }

  let liters: string | null = null;
  if (parsed.data.liters) {
    const litersNum = Number(parsed.data.liters);
    if (!Number.isFinite(litersNum) || litersNum <= 0) {
      return { error: "عدد اللترات غير صحيح" };
    }
    liters = litersNum.toFixed(2);
  }

  let mileage: number | null = null;
  if (parsed.data.mileage) {
    const mileageNum = Number(parsed.data.mileage);
    if (!Number.isInteger(mileageNum) || mileageNum < 0) {
      return { error: "قراءة العداد غير صحيحة" };
    }
    mileage = mileageNum;
  }

  // The UI defaults vehicleId from the current user's users.defaultVehicleId,
  // but that default must never be trusted blindly — validate it exists here.
  const [vehicle] = await db
    .select({ id: vehicles.id })
    .from(vehicles)
    .where(eq(vehicles.id, parsed.data.vehicleId))
    .limit(1);
  if (!vehicle) {
    return { error: "المركبة غير موجودة." };
  }

  const loggedAt = new Date();

  await db.transaction(async (tx) => {
    const [log] = await tx
      .insert(fuelLogs)
      .values({
        vehicleId: parsed.data.vehicleId,
        addedByUserId: user!.id,
        amount,
        fuelType: parsed.data.fuelType,
        liters,
        mileage,
        receiptPhotoTaken: parsed.data.receiptPhotoTaken === "true",
        notes: parsed.data.notes,
        loggedAt,
      })
      .returning({ id: fuelLogs.id });

    await recordAudit(
      {
        userId: user!.id,
        action: "fuel_log.create",
        entityType: "fuel_log",
        entityId: log.id,
        newValue: { vehicleId: parsed.data.vehicleId, amount, fuelType: parsed.data.fuelType },
      },
      tx,
    );
  });

  revalidatePath("/vehicles");
  revalidatePath(`/vehicles/${parsed.data.vehicleId}`);
  return { success: true };
}
