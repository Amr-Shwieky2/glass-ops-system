import "server-only";
import { and, desc, eq, gte, inArray, isNotNull, isNull, lt } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  jobs,
  jobStatuses,
  customers,
  customerPayments,
  technicianLedgerEntries,
  fuelLogs,
  vehicles,
} from "@/server/db/schema";
import { getAllTechniciansBalanceSummary } from "@/server/compensation/queries";
import { getJobProfitability } from "@/server/costs/queries";
import { sumMoney, subtractMoney, compareMoney, isPositive, type Money } from "@/server/money";

/**
 * Reports (spec section 68) — read-only, cross-job/cross-customer/
 * cross-technician/cross-vehicle aggregations for the management Reports
 * screens + CSV export. Every money aggregation here follows the same
 * convention as the rest of the codebase (see money.ts's own doc comment
 * and e.g. src/server/finance/queries.ts's getCashAccountBalances): fetch
 * the raw rows, group in JS, sum via money.ts — never a raw SQL SUM on a
 * numeric column.
 */

// ---------------------------------------------------------------------
// Shared date-range helpers. Filters are plain "YYYY-MM-DD" strings (as
// typed into a date-range picker); dateTo is inclusive of that whole day,
// so it's converted to an exclusive upper bound at the next UTC midnight.
// ---------------------------------------------------------------------

function startOfDayUtc(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`);
}

function dayAfterUtc(dateStr: string): Date {
  const start = startOfDayUtc(dateStr);
  return new Date(start.getTime() + 24 * 60 * 60 * 1000);
}

function monthRangeUtc(month: string): { start: Date; end: Date } {
  // month is "YYYY-MM"
  const [year, mon] = month.split("-").map(Number);
  const start = new Date(Date.UTC(year, mon - 1, 1));
  const end = new Date(Date.UTC(year, mon, 1));
  return { start, end };
}

function monthKeyUtc(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------
// 1. Jobs report
// ---------------------------------------------------------------------

export interface JobsReportRow {
  id: string;
  jobNumber: string;
  customerName: string;
  statusKey: string;
  statusLabelAr: string;
  isTerminal: boolean;
  createdAt: Date;
  salePriceTotal: Money | null;
}

export interface JobsReportCounts {
  open: number;
  completed: number;
  repairNeeded: number;
}

export interface JobsReportResult {
  rows: JobsReportRow[];
  counts: JobsReportCounts;
}

/** Statuses that mean "repair needed" for the report's bucket count —
 * mirrors seed.ts's own two repair-flow statuses (repairs.ts's own
 * `repair_status` enum is a separate, unrelated concept: this is about a
 * JOB's status, not a repair ticket's status). */
const REPAIR_STATUS_KEYS = ["repair_needed", "repair_scheduled"];

/**
 * Every job matching the filters (spec section 68): job number, customer,
 * status, created date, sale price — plus counts broken out into the
 * spec's three buckets ("Open; Completed; Repair Needed"), computed over
 * the same filtered set. Open = not isTerminal (mirrors advanceJobStatus's
 * own terminal-status concept); Completed = the `completed` status
 * specifically; Repair Needed = repair_needed/repair_scheduled.
 */
export async function getJobsReport(filters?: {
  statusKey?: string;
  dateFrom?: string;
  dateTo?: string;
}): Promise<JobsReportResult> {
  const conditions = [isNull(jobs.deletedAt)];
  if (filters?.statusKey) conditions.push(eq(jobStatuses.key, filters.statusKey));
  if (filters?.dateFrom) conditions.push(gte(jobs.createdAt, startOfDayUtc(filters.dateFrom)));
  if (filters?.dateTo) conditions.push(lt(jobs.createdAt, dayAfterUtc(filters.dateTo)));

  const rows = await db
    .select({
      id: jobs.id,
      jobNumber: jobs.jobNumber,
      customerName: customers.name,
      statusKey: jobStatuses.key,
      statusLabelAr: jobStatuses.labelAr,
      isTerminal: jobStatuses.isTerminal,
      createdAt: jobs.createdAt,
      salePriceTotal: jobs.salePriceTotal,
    })
    .from(jobs)
    .innerJoin(customers, eq(jobs.customerId, customers.id))
    .innerJoin(jobStatuses, eq(jobs.statusId, jobStatuses.id))
    .where(and(...conditions))
    .orderBy(desc(jobs.createdAt));

  const counts: JobsReportCounts = { open: 0, completed: 0, repairNeeded: 0 };
  for (const r of rows) {
    if (!r.isTerminal) counts.open += 1;
    if (r.statusKey === "completed") counts.completed += 1;
    if (REPAIR_STATUS_KEYS.includes(r.statusKey)) counts.repairNeeded += 1;
  }

  return { rows, counts };
}

// ---------------------------------------------------------------------
// 2. Customers outstanding balance report
// ---------------------------------------------------------------------

export interface CustomerOutstandingRow {
  customerId: string;
  customerName: string;
  customerPhone: string;
  outstandingBalance: Money;
  mostRecentJobId: string;
  mostRecentJobNumber: string;
  mostRecentJobDate: Date;
}

/**
 * Every customer with a positive outstanding balance, system-wide (this is
 * a management report, not scoped to a viewer's own jobs the way the
 * dashboard's tiles are — the caller/route handler gates the permission).
 * Outstanding balance = SUM(salePriceTotal) over the customer's non-deleted
 * priced jobs, minus SUM(amount) over their approved customerPayments —
 * same components getJobPayments already uses per job, aggregated here
 * across a customer's whole job history instead of reimplemented per-job.
 */
export async function getCustomersOutstandingBalanceReport(): Promise<
  CustomerOutstandingRow[]
> {
  const jobRows = await db
    .select({
      customerId: customers.id,
      customerName: customers.name,
      customerPhone: customers.phone,
      jobId: jobs.id,
      jobNumber: jobs.jobNumber,
      salePriceTotal: jobs.salePriceTotal,
      createdAt: jobs.createdAt,
    })
    .from(jobs)
    .innerJoin(customers, eq(jobs.customerId, customers.id))
    .where(and(isNull(jobs.deletedAt), isNotNull(jobs.salePriceTotal)))
    .orderBy(desc(jobs.createdAt));

  if (jobRows.length === 0) return [];

  interface CustomerAccum {
    customerName: string;
    customerPhone: string;
    saleAmounts: Money[];
    // First row encountered per customer, since jobRows is ordered by
    // createdAt desc — i.e. their most recent priced job.
    mostRecentJobId: string;
    mostRecentJobNumber: string;
    mostRecentJobDate: Date;
  }

  const byCustomer = new Map<string, CustomerAccum>();
  for (const r of jobRows) {
    const existing = byCustomer.get(r.customerId);
    if (existing) {
      existing.saleAmounts.push(r.salePriceTotal!);
    } else {
      byCustomer.set(r.customerId, {
        customerName: r.customerName,
        customerPhone: r.customerPhone,
        saleAmounts: [r.salePriceTotal!],
        mostRecentJobId: r.jobId,
        mostRecentJobNumber: r.jobNumber,
        mostRecentJobDate: r.createdAt,
      });
    }
  }

  const customerIds = [...byCustomer.keys()];
  const paymentRows = await db
    .select({
      customerId: customerPayments.customerId,
      amount: customerPayments.amount,
    })
    .from(customerPayments)
    .where(
      and(
        inArray(customerPayments.customerId, customerIds),
        eq(customerPayments.approvalStatus, "approved"),
      ),
    );

  const paidByCustomer = new Map<string, Money[]>();
  for (const p of paymentRows) {
    const list = paidByCustomer.get(p.customerId);
    if (list) list.push(p.amount);
    else paidByCustomer.set(p.customerId, [p.amount]);
  }

  const result: CustomerOutstandingRow[] = [];
  for (const [customerId, accum] of byCustomer) {
    const outstandingBalance = subtractMoney(
      sumMoney(accum.saleAmounts),
      sumMoney(paidByCustomer.get(customerId) ?? []),
    );
    if (!isPositive(outstandingBalance)) continue;
    result.push({
      customerId,
      customerName: accum.customerName,
      customerPhone: accum.customerPhone,
      outstandingBalance,
      mostRecentJobId: accum.mostRecentJobId,
      mostRecentJobNumber: accum.mostRecentJobNumber,
      mostRecentJobDate: accum.mostRecentJobDate,
    });
  }

  return result.sort((a, b) => compareMoney(b.outstandingBalance, a.outstandingBalance));
}

// ---------------------------------------------------------------------
// 3. Technicians earnings report
// ---------------------------------------------------------------------

export interface TechnicianEarningsRow {
  userId: string;
  userName: string;
  totalEarned: Money;
  totalPaid: Money;
  /** Current balance (all-time — a ledger balance is not meaningfully
   * date-scoped, see getAllTechniciansBalanceSummary), regardless of the
   * dateFrom/dateTo filter applied to totalEarned/totalPaid above. */
  remaining: Money;
}

/**
 * Per technician: total earned (positive ledger entries, approved only,
 * within the optional date range), total paid (payment_made entries'
 * absolute value, approved only, within the optional date range), and
 * remaining (their current ledger balance). Technician roster + `remaining`
 * are reused as-is from getAllTechniciansBalanceSummary rather than
 * reimplemented — only the earned/paid split (which that function doesn't
 * compute, and which needs date filtering it doesn't support) is queried
 * here directly.
 */
export async function getTechniciansEarningsReport(filters?: {
  dateFrom?: string;
  dateTo?: string;
}): Promise<TechnicianEarningsRow[]> {
  const balances = await getAllTechniciansBalanceSummary();
  if (balances.length === 0) return [];

  const userIds = balances.map((b) => b.userId);
  const conditions = [
    inArray(technicianLedgerEntries.userId, userIds),
    eq(technicianLedgerEntries.approvalStatus, "approved"),
  ];
  if (filters?.dateFrom) {
    conditions.push(gte(technicianLedgerEntries.createdAt, startOfDayUtc(filters.dateFrom)));
  }
  if (filters?.dateTo) {
    conditions.push(lt(technicianLedgerEntries.createdAt, dayAfterUtc(filters.dateTo)));
  }

  const entries = await db
    .select({
      userId: technicianLedgerEntries.userId,
      amount: technicianLedgerEntries.amount,
      entryType: technicianLedgerEntries.entryType,
    })
    .from(technicianLedgerEntries)
    .where(and(...conditions));

  const earnedByUser = new Map<string, Money[]>();
  const paidByUser = new Map<string, Money[]>();
  for (const e of entries) {
    if (e.entryType === "payment_made") {
      // Stored negative (see ledger.ts's sign-convention doc) — negate for
      // the report's "total paid" figure.
      const list = paidByUser.get(e.userId);
      const absAmount = subtractMoney("0.00", e.amount);
      if (list) list.push(absAmount);
      else paidByUser.set(e.userId, [absAmount]);
    } else if (isPositive(e.amount)) {
      const list = earnedByUser.get(e.userId);
      if (list) list.push(e.amount);
      else earnedByUser.set(e.userId, [e.amount]);
    }
  }

  return balances.map((b) => ({
    userId: b.userId,
    userName: b.userName,
    totalEarned: sumMoney(earnedByUser.get(b.userId) ?? []),
    totalPaid: sumMoney(paidByUser.get(b.userId) ?? []),
    remaining: b.balance,
  }));
}

// ---------------------------------------------------------------------
// 4. Vehicles fuel by month report
// ---------------------------------------------------------------------

export interface VehicleFuelMonthRow {
  vehicleId: string;
  vehicleName: string;
  plateNumber: string;
  /** "YYYY-MM" */
  month: string;
  totalFuelCost: Money;
  /** null when none of the month's fuel logs for this vehicle recorded liters. */
  totalLiters: string | null;
}

/**
 * Per vehicle, per month: total fuel cost and total liters (section
 * 55/56/58). Filtering to a single month narrows to that month only;
 * omitting it groups every fuel log ever recorded by (vehicle, month), the
 * same monthly-total shape the vehicle detail page already shows for the
 * current month alone (src/server/vehicles/queries.ts's costSummary) — this
 * is that same aggregation generalized across vehicles and months rather
 * than reimplemented with different math.
 */
export async function getVehiclesFuelByMonthReport(filters?: {
  month?: string;
}): Promise<VehicleFuelMonthRow[]> {
  const conditions = [];
  if (filters?.month) {
    const { start, end } = monthRangeUtc(filters.month);
    conditions.push(gte(fuelLogs.loggedAt, start), lt(fuelLogs.loggedAt, end));
  }

  const rows = await db
    .select({
      vehicleId: fuelLogs.vehicleId,
      vehicleName: vehicles.name,
      plateNumber: vehicles.plateNumber,
      amount: fuelLogs.amount,
      liters: fuelLogs.liters,
      loggedAt: fuelLogs.loggedAt,
    })
    .from(fuelLogs)
    .innerJoin(vehicles, eq(fuelLogs.vehicleId, vehicles.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined);

  interface Accum {
    vehicleId: string;
    vehicleName: string;
    plateNumber: string;
    month: string;
    costs: Money[];
    liters: Money[];
  }

  const byKey = new Map<string, Accum>();
  for (const r of rows) {
    const month = monthKeyUtc(r.loggedAt);
    const key = `${r.vehicleId}:${month}`;
    let accum = byKey.get(key);
    if (!accum) {
      accum = {
        vehicleId: r.vehicleId,
        vehicleName: r.vehicleName,
        plateNumber: r.plateNumber,
        month,
        costs: [],
        liters: [],
      };
      byKey.set(key, accum);
    }
    accum.costs.push(r.amount);
    if (r.liters !== null) accum.liters.push(r.liters);
  }

  return [...byKey.values()]
    .map((a) => ({
      vehicleId: a.vehicleId,
      vehicleName: a.vehicleName,
      plateNumber: a.plateNumber,
      month: a.month,
      totalFuelCost: sumMoney(a.costs),
      totalLiters: a.liters.length > 0 ? sumMoney(a.liters) : null,
    }))
    .sort((a, b) => a.vehicleName.localeCompare(b.vehicleName, "ar") || b.month.localeCompare(a.month));
}

// ---------------------------------------------------------------------
// 5. Profitability report
// ---------------------------------------------------------------------

export interface ProfitabilityReportRow {
  jobId: string;
  jobNumber: string;
  customerName: string;
  createdAt: Date;
  revenue: Money;
  confirmedCost: Money;
  grossProfit: Money;
  marginPercent: number | null;
}

/**
 * Profit per job (spec section 68), for jobs with a salePriceTotal set,
 * sorted by gross profit descending by default. Reuses getJobProfitability
 * (src/server/costs/queries.ts) per job rather than reimplementing the
 * revenue/cost/margin formula.
 *
 * SENSITIVE (section 48): this is raw financial visibility data, same
 * category as getJobProfitability itself. The caller (route handler) MUST
 * gate this behind can(user, PERMISSIONS.VIEW_PROFITABILITY) specifically —
 * VIEW_JOB_COSTS alone is NOT sufficient, since this also exposes revenue
 * and margin, not just confirmed cost.
 */
export async function getProfitabilityReport(filters?: {
  dateFrom?: string;
  dateTo?: string;
}): Promise<ProfitabilityReportRow[]> {
  const conditions = [isNull(jobs.deletedAt), isNotNull(jobs.salePriceTotal)];
  if (filters?.dateFrom) conditions.push(gte(jobs.createdAt, startOfDayUtc(filters.dateFrom)));
  if (filters?.dateTo) conditions.push(lt(jobs.createdAt, dayAfterUtc(filters.dateTo)));

  const jobRows = await db
    .select({
      id: jobs.id,
      jobNumber: jobs.jobNumber,
      customerName: customers.name,
      createdAt: jobs.createdAt,
    })
    .from(jobs)
    .innerJoin(customers, eq(jobs.customerId, customers.id))
    .where(and(...conditions))
    .orderBy(desc(jobs.createdAt));

  const profitabilities = await Promise.all(
    jobRows.map((j) => getJobProfitability(j.id)),
  );

  const rows: ProfitabilityReportRow[] = jobRows.map((j, i) => {
    const p = profitabilities[i];
    // revenue/grossProfit are non-null here: the query above only selects
    // jobs with salePriceTotal set, which is the sole reason
    // getJobProfitability would return a null revenue.
    return {
      jobId: j.id,
      jobNumber: j.jobNumber,
      customerName: j.customerName,
      createdAt: j.createdAt,
      revenue: p.revenue!,
      confirmedCost: p.confirmedCost,
      grossProfit: p.grossProfit!,
      marginPercent: p.marginPercent,
    };
  });

  return rows.sort((a, b) => compareMoney(b.grossProfit, a.grossProfit));
}
