import "server-only";
import { and, desc, eq, inArray, isNotNull, isNull, ne } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  jobs,
  jobStatuses,
  customers,
  users,
  productionRequests,
  factorySubmissions,
  customerPayments,
  approvalRequests,
} from "@/server/db/schema";
import { involvementFilter } from "@/server/jobs/queries";
import { getIncomingChecks, type IncomingCheckRow } from "@/server/checks/queries";
import {
  sumMoney,
  subtractMoney,
  isPositive,
  compareMoney,
  type Money,
} from "@/server/money";

/**
 * Small preview lists for the Dashboard's "Needs Attention" section
 * (spec section 59) — every function here caps its `items` at
 * PREVIEW_LIMIT rows and also returns the true `total` count, so the UI
 * can show a compact list plus a "+N more" link to the full screen
 * instead of ever rendering an unbounded list on the dashboard itself.
 *
 * Scoping: every function that lists/counts JOBS (or things hung off a
 * single job) accepts an optional `restrictToUserId` and, when set,
 * applies the exact same `involvementFilter` used elsewhere on this
 * dashboard (see src/server/repairs/queries.ts's getOpenRepairs /
 * getOpenRepairsCount, and src/app/(app)/dashboard/page.tsx's
 * readyWithoutInstall / todayAppointmentRows) — a VIEW_ASSIGNED_JOBS-only
 * viewer must never see a job/customer they are not measured-by / priced-
 * by / deal-closed-by / assigned-to. getChecksDueSoon is the one
 * exception: checks are a financial/management concern with no job-level
 * "involvement" concept, so it takes no restrictToUserId at all — the
 * CALLER must gate visibility on a financial permission (MANAGE_CHECKS,
 * matching how /finance's checks section is already gated) instead.
 * See each function's own comment for the reasoning behind its exact
 * scoping choice.
 */

/** Cap on every preview `items` array below. */
export const PREVIEW_LIMIT = 5;

export interface JobsNeedingAttentionResult<T> {
  items: T[];
  total: number;
}

export interface JobWaitingForPricingRow {
  id: string;
  jobNumber: string;
  customerName: string;
  pricingResponsibleUserId: string | null;
  pricingResponsibleUserName: string | null;
  updatedAt: Date;
}

/**
 * Jobs sitting at status = waiting_for_pricing (measured, but nobody has
 * priced them yet) — section 59's "بانتظار التسعير" item. Newest-updated
 * first so the list surfaces what moved into this state most recently.
 */
export async function getJobsWaitingForPricing(
  restrictToUserId?: string,
): Promise<JobsNeedingAttentionResult<JobWaitingForPricingRow>> {
  const rows = await db
    .select({
      id: jobs.id,
      jobNumber: jobs.jobNumber,
      customerName: customers.name,
      pricingResponsibleUserId: jobs.pricingResponsibleUserId,
      pricingResponsibleUserName: users.name,
      updatedAt: jobs.updatedAt,
    })
    .from(jobs)
    .innerJoin(jobStatuses, eq(jobs.statusId, jobStatuses.id))
    .innerJoin(customers, eq(jobs.customerId, customers.id))
    .leftJoin(users, eq(jobs.pricingResponsibleUserId, users.id))
    .where(
      and(
        isNull(jobs.deletedAt),
        eq(jobStatuses.key, "waiting_for_pricing"),
        ...(restrictToUserId ? [involvementFilter(restrictToUserId)!] : []),
      ),
    )
    .orderBy(desc(jobs.updatedAt));

  return { items: rows.slice(0, PREVIEW_LIMIT), total: rows.length };
}

export interface FieldMeasurementPendingReviewRow {
  id: string;
  jobNumber: string;
  customerName: string;
  updatedAt: Date;
}

/**
 * Jobs sitting at status = field_submission_pending — created directly by
 * the New Measurement quick-submit flow (docs/superpowers/specs/
 * 2026-09-03-new-measurement-quick-submit-design.md section 7 step 4:
 * "one more small query following the exact shape of
 * getJobsWaitingForPricing"), waiting for anyone holding CREATE_PRICE to
 * pick them up and set themselves as pricingResponsibleUserId. Additive
 * query, not part of the backend stage's original six — flagged in this
 * stage's own report per the parent task's instructions. Newest-updated
 * first, matching every sibling function in this file.
 */
export async function getFieldMeasurementsPendingReview(
  restrictToUserId?: string,
): Promise<JobsNeedingAttentionResult<FieldMeasurementPendingReviewRow>> {
  const rows = await db
    .select({
      id: jobs.id,
      jobNumber: jobs.jobNumber,
      customerName: customers.name,
      updatedAt: jobs.updatedAt,
    })
    .from(jobs)
    .innerJoin(jobStatuses, eq(jobs.statusId, jobStatuses.id))
    .innerJoin(customers, eq(jobs.customerId, customers.id))
    .where(
      and(
        isNull(jobs.deletedAt),
        eq(jobStatuses.key, "field_submission_pending"),
        ...(restrictToUserId ? [involvementFilter(restrictToUserId)!] : []),
      ),
    )
    .orderBy(desc(jobs.updatedAt));

  return { items: rows.slice(0, PREVIEW_LIMIT), total: rows.length };
}

export interface JobWaitingForQuoteSignatureRow {
  id: string;
  jobNumber: string;
  customerName: string;
  statusKey: string;
  updatedAt: Date;
}

/**
 * Jobs whose quote has gone out but the customer has not signed yet.
 * Per job_statuses' sort order in seed.ts, quote_sent (index 4) is the
 * status advanceJobStatus actually moves a job to right after a quote is
 * generated (src/server/quotes/actions.ts), and waiting_for_customer_
 * approval (index 5) sits right after it in the same "not signed" stretch
 * before quote_signed (index 6). Both statuses are included here — a job
 * can rest in either one depending on how far the current flow's
 * transitions take it — so this list never misses a job just because a
 * later phase started (or stops) explicitly setting the intermediate
 * waiting_for_customer_approval status.
 */
export async function getJobsWaitingForQuoteSignature(
  restrictToUserId?: string,
): Promise<JobsNeedingAttentionResult<JobWaitingForQuoteSignatureRow>> {
  const rows = await db
    .select({
      id: jobs.id,
      jobNumber: jobs.jobNumber,
      customerName: customers.name,
      statusKey: jobStatuses.key,
      updatedAt: jobs.updatedAt,
    })
    .from(jobs)
    .innerJoin(jobStatuses, eq(jobs.statusId, jobStatuses.id))
    .innerJoin(customers, eq(jobs.customerId, customers.id))
    .where(
      and(
        isNull(jobs.deletedAt),
        inArray(jobStatuses.key, ["quote_sent", "waiting_for_customer_approval"]),
        ...(restrictToUserId ? [involvementFilter(restrictToUserId)!] : []),
      ),
    )
    .orderBy(desc(jobs.updatedAt));

  return { items: rows.slice(0, PREVIEW_LIMIT), total: rows.length };
}

export interface FactoryPriceWaitingApprovalRow {
  id: string;
  jobId: string;
  jobNumber: string;
  customerName: string;
  latestSubmittedPrice: Money | null;
  submittedAt: Date | null;
}

/**
 * production_requests currently at status='submitted' — the factory has
 * submitted a price and it is awaiting our approve/reject decision
 * (section 43-45). Nothing reusable for "just the submitted ones" already
 * existed in src/server/production/queries.ts (listProductionRequests
 * takes an arbitrary status filter for the full /production list page,
 * not a dashboard-shaped preview+count), so this is a new, narrower query
 * against the same tables.
 */
export async function getFactoryPricesWaitingApproval(
  restrictToUserId?: string,
): Promise<JobsNeedingAttentionResult<FactoryPriceWaitingApprovalRow>> {
  const rows = await db
    .select({
      id: productionRequests.id,
      jobId: jobs.id,
      jobNumber: jobs.jobNumber,
      customerName: customers.name,
      updatedAt: productionRequests.updatedAt,
    })
    .from(productionRequests)
    .innerJoin(jobs, eq(productionRequests.jobId, jobs.id))
    .innerJoin(customers, eq(jobs.customerId, customers.id))
    .where(
      and(
        eq(productionRequests.status, "submitted"),
        isNull(jobs.deletedAt),
        ...(restrictToUserId ? [involvementFilter(restrictToUserId)!] : []),
      ),
    )
    .orderBy(desc(productionRequests.updatedAt));

  const total = rows.length;
  const preview = rows.slice(0, PREVIEW_LIMIT);

  // Attach each preview row's latest factory submission (price/date) —
  // only fetched for the slice actually shown, never for the full set.
  const latestByRequest = new Map<string, { submittedPrice: Money; submittedAt: Date }>();
  if (preview.length > 0) {
    const submissionRows = await db
      .select({
        productionRequestId: factorySubmissions.productionRequestId,
        submittedPrice: factorySubmissions.submittedPrice,
        submittedAt: factorySubmissions.submittedAt,
      })
      .from(factorySubmissions)
      .where(
        inArray(
          factorySubmissions.productionRequestId,
          preview.map((r) => r.id),
        ),
      )
      .orderBy(desc(factorySubmissions.submittedAt));
    for (const s of submissionRows) {
      if (!latestByRequest.has(s.productionRequestId)) {
        latestByRequest.set(s.productionRequestId, {
          submittedPrice: s.submittedPrice,
          submittedAt: s.submittedAt,
        });
      }
    }
  }

  return {
    items: preview.map((r) => ({
      id: r.id,
      jobId: r.jobId,
      jobNumber: r.jobNumber,
      customerName: r.customerName,
      latestSubmittedPrice: latestByRequest.get(r.id)?.submittedPrice ?? null,
      submittedAt: latestByRequest.get(r.id)?.submittedAt ?? null,
    })),
    total,
  };
}

export interface CustomerWithOutstandingBalanceRow {
  customerId: string;
  customerName: string;
  salePriceTotal: Money;
  totalPaid: Money;
  remaining: Money;
}

/**
 * Customers whose approved-payments total is less than the sum of
 * salePriceTotal across their own non-cancelled, non-deleted jobs that
 * have a salePriceTotal set — i.e. a real positive remaining balance
 * (section 59's "أرصدة عملاء مستحقة"). Summed in JS via src/server/
 * money.ts (sumMoney/subtractMoney/isPositive) rather than a raw SQL
 * SUM(), matching this codebase's existing convention for money
 * aggregation (see getTechnicianLedger / getAllTechniciansBalanceSummary
 * in src/server/compensation/queries.ts) — fetch the rows, sum with
 * decimal.js, never `+`/`-` on money strings directly.
 *
 * Scoping judgement call: a customer can have jobs spread across many
 * technicians, so there is no single job to run involvementFilter
 * against the way the other functions here do. The correct figure for
 * "this customer's outstanding balance" only makes sense computed across
 * ALL of that customer's jobs — narrowing the SUM itself to only the
 * viewer's own jobs would just be a wrong number, not a safely-scoped
 * one. So for a restricted viewer this scopes *which customers appear*
 * (only customers who have at least one job that viewer is involved in —
 * reusing involvementFilter for that membership check), while each
 * qualifying customer's balance is still computed from the customer's
 * complete job history. That keeps the disclosed number financially
 * correct while still never surfacing a customer the viewer has no
 * connection to at all.
 */
export async function getCustomersWithOutstandingBalance(
  restrictToUserId?: string,
): Promise<JobsNeedingAttentionResult<CustomerWithOutstandingBalanceRow>> {
  let allowedCustomerIds: Set<string> | null = null;
  if (restrictToUserId) {
    const involvedJobs = await db
      .select({ customerId: jobs.customerId })
      .from(jobs)
      .where(and(isNull(jobs.deletedAt), involvementFilter(restrictToUserId)!));
    allowedCustomerIds = new Set(involvedJobs.map((j) => j.customerId));
    if (allowedCustomerIds.size === 0) {
      return { items: [], total: 0 };
    }
  }

  const jobRows = await db
    .select({
      jobId: jobs.id,
      customerId: jobs.customerId,
      customerName: customers.name,
      salePriceTotal: jobs.salePriceTotal,
    })
    .from(jobs)
    .innerJoin(customers, eq(jobs.customerId, customers.id))
    .innerJoin(jobStatuses, eq(jobs.statusId, jobStatuses.id))
    .where(
      and(
        isNull(jobs.deletedAt),
        isNull(customers.deletedAt),
        ne(jobStatuses.key, "cancelled"),
        isNotNull(jobs.salePriceTotal),
      ),
    );

  // salePriceTotal is NOT NULL per the query above, but the column type
  // itself is still nullable — narrow it here so downstream code can push
  // it straight into Money-typed arrays.
  const pricedJobRows = jobRows as (typeof jobRows[number] & { salePriceTotal: Money })[];

  const relevantJobRows = allowedCustomerIds
    ? pricedJobRows.filter((r) => allowedCustomerIds!.has(r.customerId))
    : pricedJobRows;

  if (relevantJobRows.length === 0) {
    return { items: [], total: 0 };
  }

  const jobIds = relevantJobRows.map((r) => r.jobId);
  const paymentRows = await db
    .select({ jobId: customerPayments.jobId, amount: customerPayments.amount })
    .from(customerPayments)
    .where(
      and(
        inArray(customerPayments.jobId, jobIds),
        eq(customerPayments.approvalStatus, "approved"),
      ),
    );

  const paidByJob = new Map<string, Money[]>();
  for (const p of paymentRows) {
    const arr = paidByJob.get(p.jobId) ?? [];
    arr.push(p.amount);
    paidByJob.set(p.jobId, arr);
  }

  const byCustomer = new Map<
    string,
    { name: string; sales: Money[]; paid: Money[] }
  >();
  for (const r of relevantJobRows) {
    const entry = byCustomer.get(r.customerId) ?? {
      name: r.customerName,
      sales: [],
      paid: [],
    };
    entry.sales.push(r.salePriceTotal);
    entry.paid.push(...(paidByJob.get(r.jobId) ?? []));
    byCustomer.set(r.customerId, entry);
  }

  const results: CustomerWithOutstandingBalanceRow[] = [];
  for (const [customerId, { name, sales, paid }] of byCustomer) {
    const salePriceTotal = sumMoney(sales);
    const totalPaid = sumMoney(paid);
    const remaining = subtractMoney(salePriceTotal, totalPaid);
    if (isPositive(remaining)) {
      results.push({ customerId, customerName: name, salePriceTotal, totalPaid, remaining });
    }
  }
  results.sort((a, b) => compareMoney(b.remaining, a.remaining));

  return { items: results.slice(0, PREVIEW_LIMIT), total: results.length };
}

/**
 * Incoming checks due soon (section 59's "شيكات مستحقة قريباً" / section
 * 39's isCheckDueSoon), still in a status where "due soon" is meaningful
 * ('future' or already-flipped 'due_soon' — never deposited/cleared/
 * failed/cancelled). Reuses getIncomingChecks (which already applies the
 * configured checkDueSoonDays threshold via getSetting and returns
 * isDueSoon per row) instead of re-implementing the threshold lookup.
 *
 * Deliberately takes NO restrictToUserId: checks are a financial/
 * management concern tied to a customer/job only incidentally, with no
 * "technician involvement" concept the way a job has. The CALLER (the
 * dashboard page, in the UI stage) must gate whether to show this item at
 * all behind a financial-visibility permission — PERMISSIONS.MANAGE_CHECKS,
 * the same permission that already gates the checks section of
 * src/app/(app)/finance/page.tsx — rather than this function silently
 * returning an empty list for viewers who lack it.
 */
export async function getChecksDueSoon(): Promise<
  JobsNeedingAttentionResult<IncomingCheckRow>
> {
  const checks = await getIncomingChecks();
  const dueSoon = checks.filter(
    (c) => c.isDueSoon && (c.status === "future" || c.status === "due_soon"),
  );
  return { items: dueSoon.slice(0, PREVIEW_LIMIT), total: dueSoon.length };
}

/**
 * Lightweight count of approval_requests with status='pending' (section
 * 59 / 61's "طلبات بانتظار الموافقة" tile) — deliberately just a number,
 * not items+total, since the tile links straight to /approvals rather
 * than rendering a preview list of its own.
 *
 * Scoping judgement call: every other function here accepts
 * restrictToUserId as a hard requirement, so this one does too — for a
 * restricted viewer it counts only pending requests whose relatedJobId is
 * a job that viewer is involved in (approval_requests with a null
 * relatedJobId, e.g. a technician-ledger-entry approval with no job
 * attached, are excluded for a restricted viewer rather than guessed at —
 * the safe default when involvement can't be determined). That keeps the
 * function itself honest and consistent with every other query in this
 * file. In practice /approvals and APPROVE_REQUESTS are already a broad
 * managerial permission (see src/app/(app)/approvals/page.tsx), so the
 * UI stage should ALSO gate the whole "Pending Approvals" dashboard tile
 * behind PERMISSIONS.APPROVE_REQUESTS outright — restrictToUserId here is
 * defense-in-depth for that call, not a replacement for the permission
 * check, matching how /approvals itself works.
 */
export async function getPendingApprovalsCount(
  restrictToUserId?: string,
): Promise<number> {
  const rows = await db
    .select({ id: approvalRequests.id })
    .from(approvalRequests)
    .leftJoin(jobs, eq(approvalRequests.relatedJobId, jobs.id))
    .where(
      and(
        eq(approvalRequests.status, "pending"),
        ...(restrictToUserId ? [involvementFilter(restrictToUserId)!] : []),
      ),
    );
  return rows.length;
}
