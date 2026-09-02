import "server-only";
import { and, count, desc, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { notifications } from "@/server/db/schema";
import type { Database } from "@/server/db/client";
import { getCurrentUser } from "@/server/auth/session";

export interface ActionState {
  error?: string;
  success?: boolean;
}

export interface Notification {
  id: string;
  userId: string;
  type: string;
  title: string;
  body: string | null;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  isRead: boolean;
  readAt: Date | null;
  createdAt: Date;
}

/**
 * In-app notifications (section 63) — free, no SMS/push provider. Business
 * actions across every phase call notifyUser() as a side effect (e.g. "your
 * measurement is ready for pricing"); the inbox UI (bell icon, mark-as-read)
 * is built once in Phase 10, but the write side is needed from Phase 4 on,
 * so it lives here as a small shared helper from the start.
 */
export async function notifyUser(
  params: {
    userId: string;
    type: string;
    title: string;
    body?: string;
    relatedEntityType?: string;
    relatedEntityId?: string;
  },
  executor: Database = db,
): Promise<void> {
  await executor.insert(notifications).values({
    userId: params.userId,
    type: params.type,
    title: params.title,
    body: params.body,
    relatedEntityType: params.relatedEntityType,
    relatedEntityId: params.relatedEntityId,
  });
}

/** Same notification to several users at once (e.g. everyone with a permission). */
export async function notifyUsers(
  userIds: string[],
  params: Omit<Parameters<typeof notifyUser>[0], "userId">,
  executor: Database = db,
): Promise<void> {
  if (userIds.length === 0) return;
  await executor.insert(notifications).values(
    userIds.map((userId) => ({
      userId,
      type: params.type,
      title: params.title,
      body: params.body,
      relatedEntityType: params.relatedEntityType,
      relatedEntityId: params.relatedEntityId,
    })),
  );
}

/** A user's notifications, newest first, for the inbox UI (section 63). */
export async function getNotificationsForUser(
  userId: string,
  limit = 50,
): Promise<Notification[]> {
  return db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
}

/** Unread count for the header bell badge. */
export async function getUnreadNotificationCount(userId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));
  return row?.value ?? 0;
}

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
  "use server";

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
  "use server";

  const user = await getCurrentUser();
  if (!user) return { error: "يجب تسجيل الدخول." };

  await db
    .update(notifications)
    .set({ isRead: true, readAt: new Date() })
    .where(and(eq(notifications.userId, user.id), eq(notifications.isRead, false)));

  return { success: true };
}
