import "server-only";
import { asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { users, userPermissions } from "@/server/db/schema";
import type { Money } from "@/server/money";

export interface UserListRow {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  status: "active" | "suspended";
  defaultVehicleId: string | null;
  dailyWageAmount: Money | null;
  /** Count of rows in user_permissions for this user — a quick "how much
   *  access does this account have" signal for the admin list, not the
   *  full set (see getUserDetail for that). */
  permissionCount: number;
}

/**
 * Every user in the system, active AND suspended alike (admins must never
 * have suspended accounts hidden from them — that's exactly the account
 * they're most likely trying to find). Soft-deleted users (deletedAt set)
 * are excluded: that column marks an account as gone, not merely disabled,
 * and no action in this module ever sets it.
 */
export async function listUsers(): Promise<UserListRow[]> {
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      phone: users.phone,
      email: users.email,
      status: users.status,
      defaultVehicleId: users.defaultVehicleId,
      dailyWageAmount: users.dailyWageAmount,
      permissionCount: sql<number>`count(${userPermissions.permissionKey})`.mapWith(Number),
    })
    .from(users)
    .leftJoin(userPermissions, eq(userPermissions.userId, users.id))
    .where(isNull(users.deletedAt))
    .groupBy(users.id)
    .orderBy(asc(users.name));

  return rows;
}

export interface UserDetail {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  status: "active" | "suspended";
  defaultVehicleId: string | null;
  dailyWageAmount: Money | null;
  createdAt: Date;
  /** Every permission key currently granted to this user, from
   *  user_permissions — the admin Permissions screen's source of truth for
   *  which toggles start "on". */
  permissionKeys: string[];
}

/** One user plus their full set of granted permission keys, or null if the
 *  id doesn't resolve to a live (non-soft-deleted) user. */
export async function getUserDetail(userId: string): Promise<UserDetail | null> {
  const [row] = await db
    .select({
      id: users.id,
      name: users.name,
      phone: users.phone,
      email: users.email,
      status: users.status,
      defaultVehicleId: users.defaultVehicleId,
      dailyWageAmount: users.dailyWageAmount,
      createdAt: users.createdAt,
      deletedAt: users.deletedAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!row || row.deletedAt) return null;

  const grants = await db
    .select({ permissionKey: userPermissions.permissionKey })
    .from(userPermissions)
    .where(eq(userPermissions.userId, userId));

  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    status: row.status,
    defaultVehicleId: row.defaultVehicleId,
    dailyWageAmount: row.dailyWageAmount,
    createdAt: row.createdAt,
    permissionKeys: grants.map((g) => g.permissionKey),
  };
}
