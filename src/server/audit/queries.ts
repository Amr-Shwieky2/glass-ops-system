import "server-only";
import { and, count, desc, eq, gte, lte } from "drizzle-orm";
import { db } from "@/server/db/client";
import { auditLogs, users } from "@/server/db/schema";

export interface AuditLogRow {
  id: string;
  userId: string | null;
  /** The acting user's current name, or null for a system-initiated action
   *  (userId itself null, per the schema) — never assume userId implies a
   *  live joinable user, though in practice users are never hard-deleted. */
  userName: string | null;
  action: string;
  entityType: string;
  entityId: string;
  oldValue: unknown;
  newValue: unknown;
  createdAt: Date;
}

export interface AuditLogFilters {
  entityType?: string;
  userId?: string;
  dateFrom?: Date;
  dateTo?: Date;
}

const DEFAULT_LIMIT = 50;

/**
 * A newest-first page of the audit trail (section 62), with the acting
 * user's name left-joined in (auditLogs.userId is nullable for
 * system-initiated actions — see the schema comment on audit_logs).
 *
 * All filters compose into one WHERE built from the schema's two existing
 * indexes: entityType alone (or with entityId, though this admin screen
 * only ever filters by type) is the leading column of
 * audit_logs_entity_idx, and dateFrom/dateTo hit audit_logs_created_at_idx
 * directly — so a date-bounded or entity-bounded query is index-scanned,
 * never a full table scan. userId has no dedicated index (not worth one
 * for a screen read far less often than audit_logs is written to); it
 * still composes into the same WHERE and simply doesn't get index help on
 * its own.
 */
export async function getAuditLog(
  filters: AuditLogFilters = {},
  limit: number = DEFAULT_LIMIT,
  offset: number = 0,
): Promise<{ rows: AuditLogRow[]; total: number }> {
  const conditions = [];
  if (filters.entityType) conditions.push(eq(auditLogs.entityType, filters.entityType));
  if (filters.userId) conditions.push(eq(auditLogs.userId, filters.userId));
  if (filters.dateFrom) conditions.push(gte(auditLogs.createdAt, filters.dateFrom));
  if (filters.dateTo) conditions.push(lte(auditLogs.createdAt, filters.dateTo));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, totalRows] = await Promise.all([
    db
      .select({
        id: auditLogs.id,
        userId: auditLogs.userId,
        userName: users.name,
        action: auditLogs.action,
        entityType: auditLogs.entityType,
        entityId: auditLogs.entityId,
        oldValue: auditLogs.oldValue,
        newValue: auditLogs.newValue,
        createdAt: auditLogs.createdAt,
      })
      .from(auditLogs)
      .leftJoin(users, eq(auditLogs.userId, users.id))
      .where(where)
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ value: count() }).from(auditLogs).where(where),
  ]);

  return { rows, total: totalRows[0]?.value ?? 0 };
}
