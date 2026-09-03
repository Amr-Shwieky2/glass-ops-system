import "server-only";
import { and, count, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/server/db/client";
import { notifications, technicianLedgerEntries, cashExpenseReports } from "@/server/db/schema";
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
  /**
   * Where clicking this notification should navigate, resolved server-side
   * per relatedEntityType — the bell (a Client Component) has no DB access
   * of its own to work this out. Mirrors
   * src/server/approvals/queries.ts's buildViewHref for the same entity
   * types that notifyUser()/notifyUsers() are ever called with (grep
   * relatedEntityType across src/server for the exhaustive list): "job" ->
   * the job page; "technician_ledger_entry" -> the entry's OWNING user's
   * ledger page (not the requester, not the current viewer — looked up the
   * same way approvals/queries.ts does it); "cash_transfer" -> the shared
   * cash screen (no per-transfer page exists); "cash_expense_report" ->
   * the report's OWNING (reportedByUserId) user's ledger page, same
   * lookup-by-second-query shape as technician_ledger_entry. null when
   * there is nowhere to navigate (or the entity type is unrecognized).
   */
  href: string | null;
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
  const rows = await db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);

  const ledgerEntryIds = rows
    .filter((r) => r.relatedEntityType === "technician_ledger_entry" && r.relatedEntityId)
    .map((r) => r.relatedEntityId as string);

  const ledgerOwnerByEntryId = new Map<string, string>();
  if (ledgerEntryIds.length > 0) {
    const entries = await db
      .select({ id: technicianLedgerEntries.id, userId: technicianLedgerEntries.userId })
      .from(technicianLedgerEntries)
      .where(inArray(technicianLedgerEntries.id, ledgerEntryIds));
    for (const entry of entries) {
      ledgerOwnerByEntryId.set(entry.id, entry.userId);
    }
  }

  const expenseReportIds = rows
    .filter((r) => r.relatedEntityType === "cash_expense_report" && r.relatedEntityId)
    .map((r) => r.relatedEntityId as string);

  const expenseReporterByReportId = new Map<string, string>();
  if (expenseReportIds.length > 0) {
    const reports = await db
      .select({ id: cashExpenseReports.id, reportedByUserId: cashExpenseReports.reportedByUserId })
      .from(cashExpenseReports)
      .where(inArray(cashExpenseReports.id, expenseReportIds));
    for (const report of reports) {
      expenseReporterByReportId.set(report.id, report.reportedByUserId);
    }
  }

  return rows.map((row) => ({
    ...row,
    href: resolveNotificationHref(row, ledgerOwnerByEntryId, expenseReporterByReportId),
  }));
}

function resolveNotificationHref(
  row: { relatedEntityType: string | null; relatedEntityId: string | null },
  ledgerOwnerByEntryId: Map<string, string>,
  expenseReporterByReportId: Map<string, string>,
): string | null {
  if (!row.relatedEntityType || !row.relatedEntityId) return null;
  switch (row.relatedEntityType) {
    case "job":
      return `/jobs/${row.relatedEntityId}`;
    case "technician_ledger_entry": {
      const ownerId = ledgerOwnerByEntryId.get(row.relatedEntityId);
      return ownerId ? `/finance/technicians/${ownerId}` : "/finance/technicians";
    }
    case "cash_expense_report": {
      const reporterId = expenseReporterByReportId.get(row.relatedEntityId);
      return reporterId ? `/finance/technicians/${reporterId}` : "/finance/technicians";
    }
    case "cash_transfer":
      return "/finance/cash";
    default:
      return null;
  }
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
