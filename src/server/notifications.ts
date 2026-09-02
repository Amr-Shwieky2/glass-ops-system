import "server-only";
import { and, count, desc, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { notifications } from "@/server/db/schema";
import type { Database } from "@/server/db/client";

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

// markNotificationReadAction / markAllNotificationsReadAction live in
// ./notifications-actions.ts (a dedicated "use server" file), NOT here.
// This module is imported by plain server code all over the app (queries.ts
// files, other Server Actions) as well as by getNotificationsForUser() from
// the /api/notifications Route Handler, and it carries `import "server-only"`
// plus a direct import of the pg-backed `db` client. A Client Component
// (notification-bell.tsx) needs to call the two mark-read actions directly,
// and mixing those into this file broke that: Next bundled this entire
// module (including `pg`, which needs Node's `tls`/`util/types`) into the
// client bundle, 500ing every route under (app). Keeping the two mutating
// actions in their own file, with no other value exports and no
// `import "server-only"`, lets Next's "use server" handling replace them
// with a server-action reference in the client bundle instead of inlining
// their code (and their `db`/`server-only` imports) into it.
