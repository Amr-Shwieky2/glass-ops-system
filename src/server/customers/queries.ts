import "server-only";
import { and, count, desc, eq, exists, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  customers,
  jobs,
  jobStatuses,
  quotes,
  quoteVersions,
  customerPayments,
  repairs,
  auditLogs,
  users,
} from "@/server/db/schema";
import { involvementFilter } from "@/server/jobs/queries";
import { getIncomingChecks, type IncomingCheckRow } from "@/server/checks/queries";
import { sumMoney, subtractMoney, type Money } from "@/server/money";

export interface CustomerListRow {
  id: string;
  name: string;
  phone: string;
  address: string | null;
  createdAt: Date;
  jobsCount: number;
}

export async function listCustomers(params: {
  search?: string;
  limit?: number;
  offset?: number;
  /** Set when the viewer only has VIEW_ASSIGNED_JOBS, not VIEW_ALL_JOBS —
   * mirrors listJobs' own restrictToUserId (src/server/jobs/queries.ts):
   * a restricted viewer should only ever see customers they have an
   * actual job relationship with, never the full company directory
   * (Sprint 1 security hardening — VIEW_CUSTOMERS alone previously let
   * any authenticated user, including an installer, browse every
   * customer). */
  restrictToUserId?: string;
}): Promise<{ rows: CustomerListRow[]; total: number }> {
  const { search, limit = 50, offset = 0, restrictToUserId } = params;

  const conditions = [isNull(customers.deletedAt)];
  const term = search?.trim();
  if (term) {
    const pattern = `%${term}%`;
    conditions.push(
      or(ilike(customers.name, pattern), ilike(customers.phone, pattern))!,
    );
  }
  if (restrictToUserId) {
    conditions.push(
      exists(
        db
          .select({ one: sql`1` })
          .from(jobs)
          .where(
            and(
              eq(jobs.customerId, customers.id),
              isNull(jobs.deletedAt),
              involvementFilter(restrictToUserId),
            ),
          ),
      ),
    );
  }
  const where = and(...conditions);

  const [rows, [{ value: total }]] = await Promise.all([
    db
      .select({
        id: customers.id,
        name: customers.name,
        phone: customers.phone,
        address: customers.address,
        createdAt: customers.createdAt,
        jobsCount: count(jobs.id),
      })
      .from(customers)
      .leftJoin(
        jobs,
        and(eq(jobs.customerId, customers.id), isNull(jobs.deletedAt)),
      )
      .where(where)
      .groupBy(customers.id)
      .orderBy(desc(customers.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ value: count() }).from(customers).where(where),
  ]);

  return { rows, total };
}

/** Whether `userId` has any job relationship (measured/priced/closed/
 * assigned) with `customerId` — the customer-page equivalent of
 * involvementFilter, used to scope /customers/[id] for a viewer without
 * VIEW_ALL_JOBS the same way /jobs/[id] is already scoped (Sprint 1
 * security hardening: getCustomerById previously had no ownership
 * predicate at all, letting any VIEW_CUSTOMERS holder — including an
 * installer — read any customer's PII, national ID included). */
export async function isUserInvolvedWithCustomer(
  customerId: string,
  userId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ one: sql`1` })
    .from(jobs)
    .where(
      and(
        eq(jobs.customerId, customerId),
        isNull(jobs.deletedAt),
        involvementFilter(userId),
      ),
    )
    .limit(1);
  return !!row;
}

export async function getCustomerById(id: string) {
  const rows = await db
    .select()
    .from(customers)
    .where(and(eq(customers.id, id), isNull(customers.deletedAt)))
    .limit(1);
  return rows[0] ?? null;
}

export async function getCustomerJobs(customerId: string) {
  return db
    .select({
      id: jobs.id,
      jobNumber: jobs.jobNumber,
      title: jobs.title,
      createdAt: jobs.createdAt,
      salePriceTotal: jobs.salePriceTotal,
      statusKey: jobStatuses.key,
      statusLabelAr: jobStatuses.labelAr,
      statusColor: jobStatuses.color,
    })
    .from(jobs)
    .innerJoin(jobStatuses, eq(jobs.statusId, jobStatuses.id))
    .where(and(eq(jobs.customerId, customerId), isNull(jobs.deletedAt)))
    .orderBy(desc(jobs.createdAt));
}

// ---------------------------------------------------------------------
// Sprint 6 — customer detail page completeness (R1.15/S6.1/S6.4): the
// page previously showed only 2 of the 8 required sections (profile +
// jobs). Everything below adds the remaining 6 (quotes, payments, checks,
// outstanding balance, repairs, activity), each scoped to this ONE
// customer across all of their jobs — never a second, unscoped query that
// would leak another customer's data through a shared helper.
// ---------------------------------------------------------------------

export interface CustomerQuoteRow {
  id: string;
  quoteNumber: string;
  jobId: string;
  jobNumber: string;
  status: string;
  total: string | null;
  createdAt: Date;
}

/** Every quote across every one of this customer's jobs, newest first. */
export async function getCustomerQuotes(customerId: string): Promise<CustomerQuoteRow[]> {
  return db
    .select({
      id: quotes.id,
      quoteNumber: quotes.quoteNumber,
      jobId: quotes.jobId,
      jobNumber: jobs.jobNumber,
      status: quotes.status,
      total: quoteVersions.total,
      createdAt: quotes.createdAt,
    })
    .from(quotes)
    .innerJoin(jobs, eq(quotes.jobId, jobs.id))
    .leftJoin(quoteVersions, eq(quotes.currentVersionId, quoteVersions.id))
    .where(eq(quotes.customerId, customerId))
    .orderBy(desc(quotes.createdAt));
}

export interface CustomerPaymentRow {
  id: string;
  jobId: string;
  jobNumber: string;
  amount: Money;
  paymentDate: string;
  method: string;
  approvalStatus: string;
  receivedByUserName: string | null;
  createdAt: Date;
}

/** Every payment across every one of this customer's jobs (approved AND
 * pending, newest first) — the customer-scoped counterpart to
 * src/server/payments/queries.ts's getJobPayments, which is per-job. */
export async function getCustomerPayments(customerId: string): Promise<CustomerPaymentRow[]> {
  return db
    .select({
      id: customerPayments.id,
      jobId: customerPayments.jobId,
      jobNumber: jobs.jobNumber,
      amount: customerPayments.amount,
      paymentDate: customerPayments.paymentDate,
      method: customerPayments.method,
      approvalStatus: customerPayments.approvalStatus,
      receivedByUserName: users.name,
      createdAt: customerPayments.createdAt,
    })
    .from(customerPayments)
    .innerJoin(jobs, eq(customerPayments.jobId, jobs.id))
    .leftJoin(users, eq(customerPayments.receivedByUserId, users.id))
    .where(eq(customerPayments.customerId, customerId))
    .orderBy(desc(customerPayments.createdAt));
}

/** This customer's incoming checks — a thin customer-scoped call onto the
 * existing getIncomingChecks (which already accepts a customerId filter
 * and computes isDueSoon via the shared checkDueSoonDays setting). */
export async function getCustomerIncomingChecks(customerId: string): Promise<IncomingCheckRow[]> {
  return getIncomingChecks({ customerId });
}

export interface CustomerOutstandingBalance {
  salePriceTotal: Money;
  totalPaid: Money;
  remaining: Money;
}

/**
 * This customer's outstanding balance, summed across every one of their
 * non-cancelled, priced jobs (mirrors src/server/dashboard/needs-
 * attention.ts's getCustomersWithOutstandingBalance, but for one customer
 * and always returned — never filtered to "only if positive", since the
 * customer page should show the real figure whether it's owing, exactly
 * settled, or (rare) overpaid). Only approved payments count, same
 * transaction-derived rule as every other balance in this codebase.
 */
export async function getCustomerOutstandingBalance(
  customerId: string,
): Promise<CustomerOutstandingBalance> {
  const jobRows = await db
    .select({ jobId: jobs.id, salePriceTotal: jobs.salePriceTotal })
    .from(jobs)
    .innerJoin(jobStatuses, eq(jobs.statusId, jobStatuses.id))
    .where(
      and(
        eq(jobs.customerId, customerId),
        isNull(jobs.deletedAt),
        sql`${jobStatuses.key} <> 'cancelled'`,
        sql`${jobs.salePriceTotal} is not null`,
      ),
    );
  if (jobRows.length === 0) {
    return { salePriceTotal: "0.00", totalPaid: "0.00", remaining: "0.00" };
  }

  const jobIds = jobRows.map((r) => r.jobId);
  const paymentRows = await db
    .select({ amount: customerPayments.amount })
    .from(customerPayments)
    .where(
      and(
        inArray(customerPayments.jobId, jobIds),
        eq(customerPayments.approvalStatus, "approved"),
      ),
    );

  const salePriceTotal = sumMoney(jobRows.map((r) => r.salePriceTotal as Money));
  const totalPaid = sumMoney(paymentRows.map((r) => r.amount));
  return { salePriceTotal, totalPaid, remaining: subtractMoney(salePriceTotal, totalPaid) };
}

export interface CustomerRepairRow {
  id: string;
  jobId: string;
  jobNumber: string;
  problemDescription: string;
  dateReported: string;
  status: "open" | "scheduled" | "in_progress" | "resolved";
  responsibleUserName: string | null;
}

/** Every repair across every one of this customer's jobs, newest first. */
export async function getCustomerRepairs(customerId: string): Promise<CustomerRepairRow[]> {
  return db
    .select({
      id: repairs.id,
      jobId: repairs.jobId,
      jobNumber: jobs.jobNumber,
      problemDescription: repairs.problemDescription,
      dateReported: repairs.dateReported,
      status: repairs.status,
      responsibleUserName: users.name,
    })
    .from(repairs)
    .innerJoin(jobs, eq(repairs.jobId, jobs.id))
    .leftJoin(users, eq(repairs.responsibleUserId, users.id))
    .where(eq(jobs.customerId, customerId))
    .orderBy(desc(repairs.dateReported), desc(repairs.createdAt));
}

export interface CustomerActivityRow {
  id: string;
  action: string;
  userName: string | null;
  createdAt: Date;
  jobId: string;
  jobNumber: string;
}

/**
 * A recent-activity timeline for the customer page — every audit_logs row
 * tagged entityType='job' against one of this customer's jobs, newest
 * first, capped at `limit`. Reuses the existing audit trail (section 62)
 * rather than inventing a second, parallel "activity feed" concept; every
 * job-scoped mutation across this codebase already writes here.
 */
export async function getCustomerActivity(
  customerId: string,
  limit = 20,
): Promise<CustomerActivityRow[]> {
  const jobRows = await db
    .select({ id: jobs.id, jobNumber: jobs.jobNumber })
    .from(jobs)
    .where(eq(jobs.customerId, customerId));
  if (jobRows.length === 0) return [];
  const jobNumberById = new Map(jobRows.map((j) => [j.id, j.jobNumber]));

  const rows = await db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      userName: users.name,
      createdAt: auditLogs.createdAt,
      entityId: auditLogs.entityId,
    })
    .from(auditLogs)
    .leftJoin(users, eq(auditLogs.userId, users.id))
    .where(
      and(
        eq(auditLogs.entityType, "job"),
        inArray(
          auditLogs.entityId,
          jobRows.map((j) => j.id),
        ),
      ),
    )
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    userName: r.userName,
    createdAt: r.createdAt,
    jobId: r.entityId,
    jobNumber: jobNumberById.get(r.entityId) ?? "—",
  }));
}

/** Small search used by the "new job" customer picker and global search. */
export async function searchCustomers(term: string, limit = 8) {
  const pattern = `%${term.trim()}%`;
  return db
    .select({
      id: customers.id,
      name: customers.name,
      phone: customers.phone,
      address: customers.address,
    })
    .from(customers)
    .where(
      and(
        isNull(customers.deletedAt),
        or(ilike(customers.name, pattern), ilike(customers.phone, pattern)),
      ),
    )
    .orderBy(desc(customers.createdAt))
    .limit(limit);
}
