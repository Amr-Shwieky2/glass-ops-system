"use server";

import { and, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { notifications } from "@/server/db/schema";
import { getCurrentUser } from "@/server/auth/session";
import type { ActionState } from "./notifications";

/**
 * The two notification-inbox mutations, split out from ./notifications.ts
 * into their own "use server" file with no other value exports. That file
 * carries `import "server-only"` and a direct import of the pg-backed `db`
 * client for its plain query functions (notifyUser/getNotificationsForUser/
 * etc.) — importing a Server Action alongside those from a Client Component
 * previously bundled the whole module (pg included) into the browser build
 * and 500'd every route under (app). Keeping these two actions here, alone,
 * lets Next replace them with a server-action reference in the client
 * bundle instead.
 */

/**
 * Marks one notification read. Not permission-gated — notifications carry
 * no permission key of their own — just a basic ownership check (the row
 * must belong to the current user) enforced directly in the UPDATE's WHERE
 * clause, so a forged id for someone else's notification silently affects
 * zero rows instead of leaking a way to touch it.
 */
export async function markNotificationReadAction(
  notificationId: string,
  _prevState: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "يجب تسجيل الدخول." };

  await db
    .update(notifications)
    .set({ isRead: true, readAt: new Date() })
    .where(and(eq(notifications.id, notificationId), eq(notifications.userId, user.id)));

  return { success: true };
}

/** Marks every unread notification of the current user as read, in one UPDATE. */
export async function markAllNotificationsReadAction(
  _prevState: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "يجب تسجيل الدخول." };

  await db
    .update(notifications)
    .set({ isRead: true, readAt: new Date() })
    .where(and(eq(notifications.userId, user.id), eq(notifications.isRead, false)));

  return { success: true };
}
