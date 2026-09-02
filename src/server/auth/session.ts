import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { eq, and, isNull, gt } from "drizzle-orm";
import { db } from "@/server/db/client";
import { sessions, users, userPermissions } from "@/server/db/schema";
import { generateSecureToken, hashToken } from "@/server/tokens";

export const SESSION_COOKIE_NAME = "glass_session";
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface AuthedUser {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  status: "active" | "suspended";
  defaultVehicleId: string | null;
  dailyWageAmount: string | null;
  permissions: ReadonlySet<string>;
}

/**
 * Creates a session row + sets the httpOnly cookie. Callable ONLY from a
 * Server Action or Route Handler (Next.js forbids cookie mutation during
 * render) — see login action in src/app/(public)/login/actions.ts.
 */
export async function createSession(userId: string): Promise<void> {
  const token = generateSecureToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

  let userAgent: string | undefined;
  let ipAddress: string | undefined;
  try {
    const h = await headers();
    userAgent = h.get("user-agent") ?? undefined;
    ipAddress = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined;
  } catch {
    // headers() can throw outside a request context (e.g. in a script) —
    // session metadata is best-effort, never required.
  }

  await db.insert(sessions).values({
    userId,
    tokenHash,
    expiresAt,
    userAgent,
    ipAddress,
  });

  const jar = await cookies();
  jar.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

/** Revokes the current session (both the cookie and the DB row). */
export async function destroyCurrentSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE_NAME)?.value;
  if (token) {
    const tokenHash = hashToken(token);
    await db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(eq(sessions.tokenHash, tokenHash));
  }
  jar.delete(SESSION_COOKIE_NAME);
}

/**
 * Read-only lookup of the logged-in user + their permission set. Safe to
 * call from Server Components, Server Actions, and Route Handlers alike.
 * Returns null for anyone not authenticated, suspended, or soft-deleted —
 * callers must not distinguish "no session" from "suspended account" in
 * anything shown to the user (avoids account-enumeration).
 *
 * Wrapped in React's cache() so the (app) layout, the current page, and
 * any nested Server Component can all call this freely within one render
 * pass — it hits the database once, not once per caller.
 */
export const getCurrentUser = cache(async (): Promise<AuthedUser | null> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  const tokenHash = hashToken(token);
  const now = new Date();

  const rows = await db
    .select({
      userId: users.id,
      name: users.name,
      phone: users.phone,
      email: users.email,
      status: users.status,
      defaultVehicleId: users.defaultVehicleId,
      dailyWageAmount: users.dailyWageAmount,
      deletedAt: users.deletedAt,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(
      and(
        eq(sessions.tokenHash, tokenHash),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, now),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row || row.deletedAt || row.status !== "active") return null;

  const grants = await db
    .select({ permissionKey: userPermissions.permissionKey })
    .from(userPermissions)
    .where(eq(userPermissions.userId, row.userId));

  return {
    id: row.userId,
    name: row.name,
    phone: row.phone,
    email: row.email,
    status: row.status,
    defaultVehicleId: row.defaultVehicleId,
    dailyWageAmount: row.dailyWageAmount,
    permissions: new Set(grants.map((g) => g.permissionKey)),
  };
});
