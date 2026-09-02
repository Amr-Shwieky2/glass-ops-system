import "server-only";
import { db } from "@/server/db/client";
import { notifications } from "@/server/db/schema";
import type { Database } from "@/server/db/client";

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
