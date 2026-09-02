import "server-only";
import { db } from "@/server/db/client";
import { auditLogs } from "@/server/db/schema";
import type { Database } from "@/server/db/client";

/**
 * The ONE place that writes to audit_logs (section 62). Every mutating
 * Server Action calls this after (or, when part of one, inside) its write —
 * pass `executor` as the same `tx` used for the mutation so the audit row
 * can never exist without the change it describes, or vice versa.
 *
 * `entityId` is a plain string, not typed to a specific table, since the
 * audit trail intentionally spans every entity type in the system from one
 * table (section 62) — callers pass a short stable `action` slug like
 * "customer.create" / "job.status_change" so the log reads consistently.
 */
export async function recordAudit(
  params: {
    userId: string | null;
    action: string;
    entityType: string;
    entityId: string;
    oldValue?: unknown;
    newValue?: unknown;
  },
  executor: Database = db,
): Promise<void> {
  await executor.insert(auditLogs).values({
    userId: params.userId,
    action: params.action,
    entityType: params.entityType,
    entityId: params.entityId,
    oldValue: params.oldValue ?? null,
    newValue: params.newValue ?? null,
  });
}
