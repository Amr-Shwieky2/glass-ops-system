import "server-only";
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  approvalRequests,
  jobs,
  technicianLedgerEntries,
  cashExpenseReports,
  users,
} from "@/server/db/schema";

export type ApprovalEntityType =
  | "customer_payment"
  | "technician_ledger_entry"
  | "factory_submission"
  | "job_cost"
  | "cash_expense_report";

/**
 * One row of the unified approval queue (section 61/59) — a READ-ONLY
 * index over approval_requests. It never approves/rejects anything and
 * never re-derives amounts: `summary` is the human-readable Arabic text
 * already written by whichever action created the request (see
 * src/server/approvals/decide.ts, src/server/costs/actions.ts,
 * src/server/compensation/actions.ts and the factory-submission retrofit
 * in src/server/production/actions.ts). `viewHref` just points the UI at
 * where that entity type's REAL approve/reject controls already live —
 * this queue has no controls of its own.
 */
export interface ApprovalQueueRow {
  id: string;
  entityType: ApprovalEntityType;
  entityId: string;
  requestedByUserId: string;
  requestedByName: string;
  requestedAt: Date;
  summary: string;
  relatedJobId: string | null;
  relatedJobNumber: string | null;
  viewHref: string;
}

/**
 * Every pending approval_requests row, newest first, with the requester's
 * name and (when present) the related job's number joined in. Covers all
 * four approvable entity types:
 *  - customer_payment / job_cost: approve/reject controls live on the job
 *    page, so viewHref is "/jobs/<relatedJobId>" (relatedJobId is already
 *    stored on the approval_requests row itself for these two types).
 *  - factory_submission: controls also live on the job page (Production
 *    section), same "/jobs/<relatedJobId>" shape.
 *  - technician_ledger_entry: controls live on the technician's own ledger
 *    page ("/finance/technicians/<userId>"), which is NOT the requester —
 *    it's the ledger entry's owning userId, so a second lookup resolves it.
 *  - cash_expense_report: controls live on the same technician ledger
 *    page's cash-drawer section, keyed by reportedByUserId — resolved the
 *    same way as technician_ledger_entry above (a second lookup, since
 *    that id isn't on the approval_requests row itself).
 */
export async function getPendingApprovalRequests(): Promise<ApprovalQueueRow[]> {
  const rows = await db
    .select({
      id: approvalRequests.id,
      entityType: approvalRequests.entityType,
      entityId: approvalRequests.entityId,
      requestedByUserId: approvalRequests.requestedByUserId,
      requestedByName: users.name,
      requestedAt: approvalRequests.requestedAt,
      summary: approvalRequests.summary,
      relatedJobId: approvalRequests.relatedJobId,
      relatedJobNumber: jobs.jobNumber,
    })
    .from(approvalRequests)
    .innerJoin(users, eq(approvalRequests.requestedByUserId, users.id))
    .leftJoin(jobs, eq(approvalRequests.relatedJobId, jobs.id))
    .where(eq(approvalRequests.status, "pending"))
    .orderBy(desc(approvalRequests.requestedAt));

  const ledgerEntryIds = rows
    .filter((r) => r.entityType === "technician_ledger_entry")
    .map((r) => r.entityId);

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
    .filter((r) => r.entityType === "cash_expense_report")
    .map((r) => r.entityId);

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
    viewHref: buildViewHref(row, ledgerOwnerByEntryId, expenseReporterByReportId),
  }));
}

function buildViewHref(
  row: { entityType: ApprovalEntityType; entityId: string; relatedJobId: string | null },
  ledgerOwnerByEntryId: Map<string, string>,
  expenseReporterByReportId: Map<string, string>,
): string {
  switch (row.entityType) {
    case "customer_payment":
    case "job_cost":
    case "factory_submission":
      // relatedJobId is always set for these three types (see the
      // creators of each: recordCustomerPayment, addJobCostAction, and
      // the factory-submission retrofit in production/actions.ts).
      return row.relatedJobId ? `/jobs/${row.relatedJobId}` : "/jobs";
    case "technician_ledger_entry": {
      const ownerId = ledgerOwnerByEntryId.get(row.entityId);
      return ownerId ? `/finance/technicians/${ownerId}` : "/finance/technicians";
    }
    case "cash_expense_report": {
      const reporterId = expenseReporterByReportId.get(row.entityId);
      return reporterId ? `/finance/technicians/${reporterId}` : "/finance/technicians";
    }
  }
}
