"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/server/db/client";
import { vehicles, vehicleResponsibilityHistory } from "@/server/db/schema";
import { getCurrentUser } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { PERMISSIONS } from "@/server/auth/permission-keys";
import { recordAudit } from "@/server/audit";
import { parseNonNegativeMoneyInput } from "@/server/money";

/**
 * Extracts a Postgres error code (e.g. "23505" for a unique-violation)
 * from whatever drizzle-orm threw. drizzle-orm 0.45's node-postgres
 * driver wraps the real `pg` error (which carries `.code` directly) in a
 * `DrizzleQueryError`, with the original error attached as `.cause` —
 * not spread onto the wrapper itself — so checking `err.code` alone
 * (as elsewhere in this codebase) misses it here; this checks both.
 */
function pgErrorCode(err: unknown): string | undefined {
  const direct = (err as { code?: string } | null)?.code;
  if (direct) return direct;
  return (err as { cause?: { code?: string } } | null)?.cause?.code;
}

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

/** The day before a "YYYY-MM-DD" date string, as a "YYYY-MM-DD" string. */
function dayBefore(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

const FUEL_TYPES = ["petrol", "diesel", "electric", "hybrid", "other"] as const;

const CreateVehicleSchema = z.object({
  name: z.string().trim().min(1, { error: "اسم المركبة مطلوب" }),
  plateNumber: z.string().trim().min(1, { error: "رقم اللوحة مطلوب" }),
  fuelType: z.enum(FUEL_TYPES, { error: "نوع الوقود غير صحيح" }),
  estimatedValue: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});

/**
 * Creates a vehicle (section 55). Deliberately does NOT set
 * defaultResponsibleUserId — a vehicle can exist with no one currently
 * responsible; use assignVehicleResponsibility for that, separately.
 */
export async function createVehicleAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!can(user, PERMISSIONS.MANAGE_VEHICLES)) {
    return { error: "لا تملك صلاحية إدارة المركبات." };
  }

  const parsed = CreateVehicleSchema.safeParse({
    name: formData.get("name"),
    plateNumber: formData.get("plateNumber"),
    fuelType: formData.get("fuelType"),
    estimatedValue: emptyToUndefined(formData.get("estimatedValue")),
    notes: emptyToUndefined(formData.get("notes")),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" };
  }

  let estimatedValue: string | null = null;
  if (parsed.data.estimatedValue) {
    const money = parseNonNegativeMoneyInput(parsed.data.estimatedValue);
    if (money === null) return { error: "القيمة التقديرية غير صحيحة" };
    estimatedValue = money;
  }

  let vehicleId: string;
  try {
    vehicleId = await db.transaction(async (tx) => {
      const [vehicle] = await tx
        .insert(vehicles)
        .values({
          name: parsed.data.name,
          plateNumber: parsed.data.plateNumber,
          fuelType: parsed.data.fuelType,
          estimatedValue,
          notes: parsed.data.notes,
        })
        .returning({ id: vehicles.id });

      await recordAudit(
        {
          userId: user!.id,
          action: "vehicle.create",
          entityType: "vehicle",
          entityId: vehicle.id,
          newValue: { name: parsed.data.name, plateNumber: parsed.data.plateNumber },
        },
        tx,
      );

      return vehicle.id;
    });
  } catch (err: unknown) {
    const code = pgErrorCode(err);
    if (code === "23505") {
      return { error: "رقم اللوحة مستخدم بالفعل لمركبة أخرى." };
    }
    return { error: "تعذر إنشاء المركبة، حاول مرة أخرى." };
  }

  revalidatePath("/vehicles");
  revalidatePath(`/vehicles/${vehicleId}`);
  return { success: true };
}

const UpdateVehicleSchema = z.object({
  name: z.string().trim().min(1, { error: "اسم المركبة مطلوب" }),
  plateNumber: z.string().trim().min(1, { error: "رقم اللوحة مطلوب" }),
  fuelType: z.enum(FUEL_TYPES, { error: "نوع الوقود غير صحيح" }),
  estimatedValue: z.string().trim().optional(),
  isActive: z.enum(["true", "false"]),
  notes: z.string().trim().optional(),
});

/**
 * Edits a vehicle's own fields (section 55/58). Never touches
 * defaultResponsibleUserId or history rows — that is exclusively
 * assignVehicleResponsibility's job, see its own doc comment.
 */
export async function updateVehicleAction(
  vehicleId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!can(user, PERMISSIONS.MANAGE_VEHICLES)) {
    return { error: "لا تملك صلاحية إدارة المركبات." };
  }

  const parsed = UpdateVehicleSchema.safeParse({
    name: formData.get("name"),
    plateNumber: formData.get("plateNumber"),
    fuelType: formData.get("fuelType"),
    estimatedValue: emptyToUndefined(formData.get("estimatedValue")),
    isActive: formData.get("isActive"),
    notes: emptyToUndefined(formData.get("notes")),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" };
  }

  let estimatedValue: string | null = null;
  if (parsed.data.estimatedValue) {
    const money = parseNonNegativeMoneyInput(parsed.data.estimatedValue);
    if (money === null) return { error: "القيمة التقديرية غير صحيحة" };
    estimatedValue = money;
  }

  try {
    await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: vehicles.id })
        .from(vehicles)
        .where(eq(vehicles.id, vehicleId))
        .limit(1);
      if (!existing) throw new NotFoundError();

      await tx
        .update(vehicles)
        .set({
          name: parsed.data.name,
          plateNumber: parsed.data.plateNumber,
          fuelType: parsed.data.fuelType,
          estimatedValue,
          isActive: parsed.data.isActive === "true",
          notes: parsed.data.notes,
          updatedAt: new Date(),
        })
        .where(eq(vehicles.id, vehicleId));

      await recordAudit(
        {
          userId: user!.id,
          action: "vehicle.update",
          entityType: "vehicle",
          entityId: vehicleId,
          newValue: { ...parsed.data, estimatedValue },
        },
        tx,
      );
    });
  } catch (err: unknown) {
    if (err instanceof NotFoundError) return { error: "المركبة غير موجودة." };
    const code = pgErrorCode(err);
    if (code === "23505") {
      return { error: "رقم اللوحة مستخدم بالفعل لمركبة أخرى." };
    }
    return { error: "تعذر تحديث المركبة، حاول مرة أخرى." };
  }

  revalidatePath("/vehicles");
  revalidatePath(`/vehicles/${vehicleId}`);
  return { success: true };
}

class NotFoundError extends Error {}

const AssignResponsibilitySchema = z.object({
  userId: z.uuid({ error: "المستخدم غير صحيح" }),
  startDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, { error: "تاريخ غير صحيح" })
    .optional(),
});

/**
 * Assigns responsibility for a vehicle to a user (section 57). The ONLY
 * place that ever changes vehicles.defaultResponsibleUserId or touches
 * vehicle_responsibility_history rows: closes any currently-open row
 * (endDate IS NULL) the day before the new row's startDate, inserts the
 * new open row, and syncs the convenience pointer — all in one
 * transaction so the two can never drift apart.
 *
 * Race safety: the close-out is a single conditional
 * `UPDATE ... WHERE vehicleId = ? AND endDate IS NULL` (not a blind
 * update-by-id off a prior SELECT), and the schema carries a partial
 * unique index enforcing at most one open row per vehicle
 * (vehicle_resp_history_one_open_per_vehicle_idx). So two concurrent
 * re-assignments of the same vehicle can no longer both succeed and leave
 * two "open" rows: whichever transaction's INSERT loses the race hits a
 * 23505 unique violation, caught below and surfaced as a retry error.
 */
export async function assignVehicleResponsibility(
  vehicleId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!can(user, PERMISSIONS.MANAGE_VEHICLES)) {
    return { error: "لا تملك صلاحية إدارة المركبات." };
  }

  const parsed = AssignResponsibilitySchema.safeParse({
    userId: formData.get("userId"),
    startDate: emptyToUndefined(formData.get("startDate")),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" };
  }

  const startDate = parsed.data.startDate ?? todayDateString();

  try {
    await db.transaction(async (tx) => {
      const [vehicle] = await tx
        .select({ id: vehicles.id })
        .from(vehicles)
        .where(eq(vehicles.id, vehicleId))
        .limit(1);
      if (!vehicle) throw new NotFoundError();

      // Conditional close: only closes a row that is STILL open at the
      // moment this UPDATE runs (not the id read by some earlier SELECT).
      // Under concurrent re-assignments, Postgres serializes two such
      // UPDATEs on the same row; the second one re-evaluates
      // `endDate IS NULL` against the now-committed row and correctly
      // finds nothing left to close.
      await tx
        .update(vehicleResponsibilityHistory)
        .set({ endDate: dayBefore(startDate) })
        .where(
          and(
            eq(vehicleResponsibilityHistory.vehicleId, vehicleId),
            isNull(vehicleResponsibilityHistory.endDate),
          ),
        );

      await tx.insert(vehicleResponsibilityHistory).values({
        vehicleId,
        userId: parsed.data.userId,
        startDate,
        endDate: null,
      });

      await tx
        .update(vehicles)
        .set({ defaultResponsibleUserId: parsed.data.userId, updatedAt: new Date() })
        .where(eq(vehicles.id, vehicleId));

      await recordAudit(
        {
          userId: user!.id,
          action: "vehicle.assign_responsibility",
          entityType: "vehicle",
          entityId: vehicleId,
          newValue: { userId: parsed.data.userId, startDate },
        },
        tx,
      );
    });
  } catch (err: unknown) {
    if (err instanceof NotFoundError) return { error: "المركبة غير موجودة." };
    if (pgErrorCode(err) === "23505") {
      return { error: "تم تعديل المسؤول عن هذه المركبة بالتزامن من مستخدم آخر، حاول مرة أخرى." };
    }
    return { error: "تعذر تعيين المسؤول عن المركبة، حاول مرة أخرى." };
  }

  revalidatePath("/vehicles");
  revalidatePath(`/vehicles/${vehicleId}`);
  return { success: true };
}
