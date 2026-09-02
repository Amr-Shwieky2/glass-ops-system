"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/server/db/client";
import { users, userPermissions, sessions } from "@/server/db/schema";
import { getCurrentUser } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { PERMISSIONS, type PermissionKey } from "@/server/auth/permission-keys";
import { recordAudit } from "@/server/audit";
import { isPlausiblePhone, normalizePhone } from "@/server/tokens";
import { hashPassword, passwordMeetsPolicy } from "@/server/auth/password";
import { parseNonNegativeMoneyInput } from "@/server/money";

export interface ActionState {
  error?: string;
  success?: boolean;
}

/**
 * Extracts a Postgres error code (e.g. "23505" for a unique-violation) from
 * whatever drizzle-orm threw. drizzle-orm's node-postgres driver wraps the
 * real `pg` error (which carries `.code` directly) in a `DrizzleQueryError`,
 * with the original error attached as `.cause` — not spread onto the
 * wrapper itself — so checking `err.code` alone misses it. Mirrors the
 * identical helper in src/server/vehicles/actions.ts (that exact bug was
 * already found and fixed once in Phase 9).
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

class NotFoundError extends Error {}

const ALL_PERMISSION_KEYS = new Set<string>(Object.values(PERMISSIONS));

function isKnownPermissionKey(key: string): key is PermissionKey {
  return ALL_PERMISSION_KEYS.has(key);
}

const CreateUserSchema = z.object({
  name: z.string().trim().min(2, { error: "الاسم مطلوب (حرفان على الأقل)" }),
  phone: z.string().trim().min(1, { error: "رقم الهاتف مطلوب" }),
  email: z.string().trim().optional(),
  password: z.string().min(1, { error: "كلمة المرور مطلوبة" }),
  defaultVehicleId: z.uuid({ error: "المركبة غير صحيحة" }).optional(),
  dailyWageAmount: z.string().trim().optional(),
});

/**
 * Creates a user account (section 6/75). Requires MANAGE_USERS — note this
 * is deliberately a *different* permission than MANAGE_PERMISSIONS (a user
 * manager can create accounts and set their basic info, but cannot grant
 * them access; see grantPermissionAction). New users are always created
 * 'active' with zero permissions — the caller can never set id/status
 * directly, and permissions are a wholly separate, separately-gated step.
 */
export async function createUserAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!can(user, PERMISSIONS.MANAGE_USERS)) {
    return { error: "لا تملك صلاحية إدارة المستخدمين." };
  }

  const parsed = CreateUserSchema.safeParse({
    name: formData.get("name"),
    phone: formData.get("phone"),
    email: emptyToUndefined(formData.get("email")),
    password: formData.get("password"),
    defaultVehicleId: emptyToUndefined(formData.get("defaultVehicleId")),
    dailyWageAmount: emptyToUndefined(formData.get("dailyWageAmount")),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" };
  }

  const phone = normalizePhone(parsed.data.phone);
  if (!isPlausiblePhone(phone)) {
    return { error: "رقم الهاتف غير صحيح" };
  }

  if (!passwordMeetsPolicy(parsed.data.password)) {
    return { error: "كلمة المرور يجب أن تتكون من 8 أحرف على الأقل." };
  }

  let dailyWageAmount: string | null = null;
  if (parsed.data.dailyWageAmount) {
    const money = parseNonNegativeMoneyInput(parsed.data.dailyWageAmount);
    if (money === null) return { error: "الأجر اليومي غير صحيح" };
    dailyWageAmount = money;
  }

  const passwordHash = await hashPassword(parsed.data.password);

  let userId: string;
  try {
    userId = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(users)
        .values({
          name: parsed.data.name,
          phone,
          email: parsed.data.email ?? null,
          passwordHash,
          status: "active",
          defaultVehicleId: parsed.data.defaultVehicleId ?? null,
          dailyWageAmount,
        })
        .returning({ id: users.id });

      await recordAudit(
        {
          userId: user!.id,
          action: "user.create",
          entityType: "user",
          entityId: row.id,
          newValue: {
            name: parsed.data.name,
            phone,
            email: parsed.data.email ?? null,
            defaultVehicleId: parsed.data.defaultVehicleId ?? null,
            dailyWageAmount,
          },
        },
        tx,
      );

      return row.id;
    });
  } catch (err: unknown) {
    const code = pgErrorCode(err);
    if (code === "23505") {
      return { error: "رقم الهاتف أو البريد الإلكتروني مستخدم بالفعل لمستخدم آخر." };
    }
    if (code === "23503") {
      return { error: "المركبة المحددة غير موجودة." };
    }
    return { error: "تعذر إنشاء المستخدم، حاول مرة أخرى." };
  }

  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${userId}`);
  return { success: true };
}

const UpdateUserSchema = z.object({
  name: z.string().trim().min(2, { error: "الاسم مطلوب (حرفان على الأقل)" }),
  phone: z.string().trim().min(1, { error: "رقم الهاتف مطلوب" }),
  email: z.string().trim().optional(),
  defaultVehicleId: z.uuid({ error: "المركبة غير صحيحة" }).optional(),
  dailyWageAmount: z.string().trim().optional(),
});

/**
 * Edits a user's own basic fields (section 6/75). Deliberately does NOT
 * touch status, passwordHash, or user_permissions — each of those is its
 * own separately-gated action below, keeping every action's blast radius
 * small and its audit trail unambiguous about what actually changed.
 */
export async function updateUserAction(
  userId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!can(user, PERMISSIONS.MANAGE_USERS)) {
    return { error: "لا تملك صلاحية إدارة المستخدمين." };
  }

  const parsed = UpdateUserSchema.safeParse({
    name: formData.get("name"),
    phone: formData.get("phone"),
    email: emptyToUndefined(formData.get("email")),
    defaultVehicleId: emptyToUndefined(formData.get("defaultVehicleId")),
    dailyWageAmount: emptyToUndefined(formData.get("dailyWageAmount")),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" };
  }

  const phone = normalizePhone(parsed.data.phone);
  if (!isPlausiblePhone(phone)) {
    return { error: "رقم الهاتف غير صحيح" };
  }

  let dailyWageAmount: string | null = null;
  if (parsed.data.dailyWageAmount) {
    const money = parseNonNegativeMoneyInput(parsed.data.dailyWageAmount);
    if (money === null) return { error: "الأجر اليومي غير صحيح" };
    dailyWageAmount = money;
  }

  try {
    await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: users.id, deletedAt: users.deletedAt })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (!existing || existing.deletedAt) throw new NotFoundError();

      await tx
        .update(users)
        .set({
          name: parsed.data.name,
          phone,
          email: parsed.data.email ?? null,
          defaultVehicleId: parsed.data.defaultVehicleId ?? null,
          dailyWageAmount,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));

      await recordAudit(
        {
          userId: user!.id,
          action: "user.update",
          entityType: "user",
          entityId: userId,
          newValue: {
            name: parsed.data.name,
            phone,
            email: parsed.data.email ?? null,
            defaultVehicleId: parsed.data.defaultVehicleId ?? null,
            dailyWageAmount,
          },
        },
        tx,
      );
    });
  } catch (err: unknown) {
    if (err instanceof NotFoundError) return { error: "المستخدم غير موجود." };
    const code = pgErrorCode(err);
    if (code === "23505") {
      return { error: "رقم الهاتف أو البريد الإلكتروني مستخدم بالفعل لمستخدم آخر." };
    }
    if (code === "23503") {
      return { error: "المركبة المحددة غير موجودة." };
    }
    return { error: "تعذر تحديث المستخدم، حاول مرة أخرى." };
  }

  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${userId}`);
  return { success: true };
}

const SetUserStatusSchema = z.object({
  status: z.enum(["active", "suspended"], { error: "الحالة غير صحيحة" }),
});

/**
 * Activates or suspends a user account (section 6/75). Race-safe against a
 * double-submit or two admins acting at once: the UPDATE only affects a row
 * still at the status we last read, and its returned row count is the real
 * guard (see decideCustomerPaymentAction / decideJobCostAction for the same
 * shape) — the earlier SELECT is just a fast-fail for the common case and
 * to capture the old value for the audit row.
 *
 * A suspended user's access dies on their very next request without any
 * extra work here: getCurrentUser() (src/server/auth/session.ts) already
 * rejects any session whose user row is not status='active' — verified by
 * reading that file, not assumed. This function does not additionally
 * revoke the user's sessions rows, since that check already makes them
 * inert; resetUserPasswordAction below revokes sessions for a different,
 * independent reason (the old credential itself becoming untrusted).
 */
export async function setUserStatusAction(
  userId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!can(user, PERMISSIONS.MANAGE_USERS)) {
    return { error: "لا تملك صلاحية إدارة المستخدمين." };
  }

  const parsed = SetUserStatusSchema.safeParse({ status: formData.get("status") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" };
  }

  const [existing] = await db
    .select({ id: users.id, status: users.status, deletedAt: users.deletedAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!existing || existing.deletedAt) return { error: "المستخدم غير موجود." };
  if (existing.status === parsed.data.status) {
    return {
      error:
        existing.status === "active"
          ? "المستخدم نشط بالفعل."
          : "المستخدم موقوف بالفعل.",
    };
  }

  let changed = false;
  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(users)
      .set({ status: parsed.data.status, updatedAt: new Date() })
      .where(and(eq(users.id, userId), eq(users.status, existing.status)))
      .returning({ id: users.id });

    if (!updated) return;
    changed = true;

    await recordAudit(
      {
        userId: user!.id,
        action: "user.status_change",
        entityType: "user",
        entityId: userId,
        oldValue: { status: existing.status },
        newValue: { status: parsed.data.status },
      },
      tx,
    );
  });

  if (!changed) {
    return { error: "تم تغيير حالة المستخدم بالتزامن من مستخدم آخر، حاول مرة أخرى." };
  }

  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${userId}`);
  return { success: true };
}

const ResetPasswordSchema = z.object({
  newPassword: z.string().min(1, { error: "كلمة المرور الجديدة مطلوبة" }),
});

/**
 * Resets a user's password (section 6/75), requires MANAGE_USERS. Also
 * revokes that user's existing sessions in the same transaction: a reset
 * is typically done because the old credential is no longer trusted (a
 * lost device, a suspected compromise, an employee handover) — leaving
 * their already-issued session cookies alive would defeat the point of the
 * reset, so every one of their sessions rows is marked revoked, forcing a
 * fresh login with the new password everywhere.
 */
export async function resetUserPasswordAction(
  userId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!can(user, PERMISSIONS.MANAGE_USERS)) {
    return { error: "لا تملك صلاحية إدارة المستخدمين." };
  }

  const parsed = ResetPasswordSchema.safeParse({
    newPassword: formData.get("newPassword"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" };
  }

  if (!passwordMeetsPolicy(parsed.data.newPassword)) {
    return { error: "كلمة المرور يجب أن تتكون من 8 أحرف على الأقل." };
  }

  const [existing] = await db
    .select({ id: users.id, deletedAt: users.deletedAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!existing || existing.deletedAt) return { error: "المستخدم غير موجود." };

  const passwordHash = await hashPassword(parsed.data.newPassword);

  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(users.id, userId));

    await tx
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));

    await recordAudit(
      {
        userId: user!.id,
        action: "user.password_reset",
        entityType: "user",
        entityId: userId,
        // Never write the password itself, old or new, into the audit
        // trail — only who performed the reset and when (createdAt covers
        // "when" already).
        newValue: { resetByUserId: user!.id },
      },
      tx,
    );
  });

  revalidatePath(`/admin/users/${userId}`);
  return { success: true };
}

/**
 * Grants one permission to one user (section 7/75). Requires
 * MANAGE_PERMISSIONS — deliberately separate from MANAGE_USERS (see
 * createUserAction's doc comment): being able to create/edit accounts does
 * not imply being able to change what they can do.
 */
export async function grantPermissionAction(
  userId: string,
  permissionKey: PermissionKey,
  _prevState: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!can(user, PERMISSIONS.MANAGE_PERMISSIONS)) {
    return { error: "لا تملك صلاحية إدارة الصلاحيات." };
  }

  if (!isKnownPermissionKey(permissionKey)) {
    return { error: "الصلاحية غير معروفة." };
  }

  const [target] = await db
    .select({ id: users.id, deletedAt: users.deletedAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!target || target.deletedAt) return { error: "المستخدم غير موجود." };

  try {
    await db.transaction(async (tx) => {
      await tx.insert(userPermissions).values({
        userId,
        permissionKey,
        grantedByUserId: user!.id,
        grantedAt: new Date(),
      });

      await recordAudit(
        {
          userId: user!.id,
          action: "user_permission.grant",
          entityType: "user",
          entityId: userId,
          newValue: { permissionKey },
        },
        tx,
      );
    });
  } catch (err: unknown) {
    const code = pgErrorCode(err);
    if (code === "23505") {
      return { error: "هذه الصلاحية ممنوحة لهذا المستخدم بالفعل." };
    }
    if (code === "23503") {
      return { error: "المستخدم أو الصلاحية غير موجودة." };
    }
    return { error: "تعذر منح الصلاحية، حاول مرة أخرى." };
  }

  revalidatePath(`/admin/users/${userId}`);
  revalidatePath("/admin/permissions");
  return { success: true };
}

/**
 * Revokes one permission from one user (section 7/75). Requires
 * MANAGE_PERMISSIONS. Guards a single specific catastrophe: revoking the
 * LAST remaining grant of MANAGE_PERMISSIONS itself, system-wide, would
 * permanently lock every admin out of ever granting/revoking permissions
 * again (no one left who could grant it back).
 *
 * This is race-safe under concurrent revokes targeting *different* holders:
 * the count is taken via `SELECT ... FOR UPDATE` on every row currently
 * granting MANAGE_PERMISSIONS, which row-locks the whole matching set before
 * counting. A second, concurrent revoke of a different holder's grant then
 * blocks on that same SELECT ... FOR UPDATE until the first transaction
 * commits (or rolls back) — at which point it re-reads the post-commit set
 * and sees the correct, now-smaller count, instead of both transactions
 * computing "2 holders, safe to delete mine" from stale snapshots and
 * jointly zeroing the table (plain READ COMMITTED count-then-delete, with no
 * lock, does not prevent this — see the file history for the concrete
 * interleaving). The guard is intentionally NOT narrowed to "only when
 * revoking your own grant" — the invariant that must hold ("someone can
 * always manage permissions") is system-wide and must hold no matter who
 * performs the revoke, and it naturally covers the self-revoke case since
 * the acting user counts as one of the current holders.
 */
export async function revokePermissionAction(
  userId: string,
  permissionKey: PermissionKey,
  _prevState: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!can(user, PERMISSIONS.MANAGE_PERMISSIONS)) {
    return { error: "لا تملك صلاحية إدارة الصلاحيات." };
  }

  if (!isKnownPermissionKey(permissionKey)) {
    return { error: "الصلاحية غير معروفة." };
  }

  let removed = false;
  let blocked = false;

  await db.transaction(async (tx) => {
    if (permissionKey === PERMISSIONS.MANAGE_PERMISSIONS) {
      // Row-lock every current MANAGE_PERMISSIONS holder before counting, so
      // a concurrent revoke of a *different* holder's grant blocks here
      // until this transaction commits, instead of both racing off stale
      // snapshots (see the function doc comment).
      const holders = await tx
        .select({ userId: userPermissions.userId })
        .from(userPermissions)
        .where(eq(userPermissions.permissionKey, PERMISSIONS.MANAGE_PERMISSIONS))
        .for("update");
      if (holders.length <= 1) {
        blocked = true;
        return;
      }
    }

    const deleted = await tx
      .delete(userPermissions)
      .where(
        and(
          eq(userPermissions.userId, userId),
          eq(userPermissions.permissionKey, permissionKey),
        ),
      )
      .returning({ userId: userPermissions.userId });

    if (deleted.length === 0) return;
    removed = true;

    await recordAudit(
      {
        userId: user!.id,
        action: "user_permission.revoke",
        entityType: "user",
        entityId: userId,
        oldValue: { permissionKey },
      },
      tx,
    );
  });

  if (blocked) {
    return {
      error:
        "لا يمكن إلغاء هذه الصلاحية لأنها ستترك النظام بلا أي مستخدم يملك صلاحية إدارة الصلاحيات.",
    };
  }
  if (!removed) {
    return { error: "هذا المستخدم لا يملك هذه الصلاحية أصلاً." };
  }

  revalidatePath(`/admin/users/${userId}`);
  revalidatePath("/admin/permissions");
  return { success: true };
}
