import "server-only";
import { desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { jobCosts, jobs, users, externalContractors } from "@/server/db/schema";
import { db } from "@/server/db/client";
import { sumMoney, subtractMoney, compareMoney, type Money } from "@/server/money";

const createdByUser = alias(users, "job_cost_created_by_user");
const approvedByUser = alias(users, "job_cost_approved_by_user");
const vendorUser = alias(users, "job_cost_vendor_user");

export interface JobCost {
  id: string;
  jobId: string;
  jobItemId: string | null;
  category:
    | "factory_glass"
    | "hardware"
    | "installer_labor"
    | "daily_worker_labor"
    | "external_contractor"
    | "aluminum_contractor"
    | "fuel"
    | "other";
  amount: Money;
  description: string | null;
  vendorUserId: string | null;
  vendorUserName: string | null;
  externalContractorId: string | null;
  externalContractorName: string | null;
  ledgerEntryId: string | null;
  status: "pending" | "approved" | "rejected";
  createdByUserId: string | null;
  createdByUserName: string | null;
  approvedByUserId: string | null;
  approvedByUserName: string | null;
  approvedAt: Date | null;
  incurredAt: string;
  createdAt: Date;
}

/**
 * Every job_costs row for one job, across every category — not just the
 * ones this module creates (hardware/external_contractor/
 * aluminum_contractor/other) but also factory_glass (booked by Phase 6's
 * factory approval) and installer_labor/daily_worker_labor (booked by the
 * compensation module) — a job's cost ledger is one list regardless of
 * which part of the system created each row. totalApproved only sums
 * status='approved' rows (section 47/48): a pending/rejected cost is not
 * yet a real cost.
 */
export async function getJobCostsForJob(
  jobId: string,
): Promise<{ costs: JobCost[]; totalApproved: Money }> {
  const costs = await db
    .select({
      id: jobCosts.id,
      jobId: jobCosts.jobId,
      jobItemId: jobCosts.jobItemId,
      category: jobCosts.category,
      amount: jobCosts.amount,
      description: jobCosts.description,
      vendorUserId: jobCosts.vendorUserId,
      vendorUserName: vendorUser.name,
      externalContractorId: jobCosts.externalContractorId,
      externalContractorName: externalContractors.name,
      ledgerEntryId: jobCosts.ledgerEntryId,
      status: jobCosts.status,
      createdByUserId: jobCosts.createdByUserId,
      createdByUserName: createdByUser.name,
      approvedByUserId: jobCosts.approvedByUserId,
      approvedByUserName: approvedByUser.name,
      approvedAt: jobCosts.approvedAt,
      incurredAt: jobCosts.incurredAt,
      createdAt: jobCosts.createdAt,
    })
    .from(jobCosts)
    .leftJoin(createdByUser, eq(jobCosts.createdByUserId, createdByUser.id))
    .leftJoin(approvedByUser, eq(jobCosts.approvedByUserId, approvedByUser.id))
    .leftJoin(vendorUser, eq(jobCosts.vendorUserId, vendorUser.id))
    .leftJoin(externalContractors, eq(jobCosts.externalContractorId, externalContractors.id))
    .where(eq(jobCosts.jobId, jobId))
    .orderBy(desc(jobCosts.createdAt));

  const totalApproved = sumMoney(
    costs.filter((c) => c.status === "approved").map((c) => c.amount),
  );

  return { costs, totalApproved };
}

export interface JobProfitability {
  /** null when the job has no sale_price_total yet. */
  revenue: Money | null;
  confirmedCost: Money;
  /** null when revenue is null. */
  grossProfit: Money | null;
  /** Percentage (e.g. 32.5 for 32.5%). null when revenue is null or zero. */
  marginPercent: number | null;
}

/**
 * Revenue/cost/margin for one job (section 47/48): Revenue = sale price
 * total, Confirmed Cost = sum of approved job_costs (every category),
 * Gross Profit = Revenue - Confirmed Cost, Margin = Gross Profit / Revenue
 * guarded against a null/zero revenue (returns null, never NaN/Infinity).
 *
 * SENSITIVE (section 48): this is raw financial visibility data. Callers
 * MUST gate rendering it behind can(user, PERMISSIONS.VIEW_PROFITABILITY)
 * (or VIEW_JOB_COSTS for confirmedCost alone) — this function itself does
 * NOT check any permission, it is a pure data query.
 */
export async function getJobProfitability(jobId: string): Promise<JobProfitability> {
  const [{ totalApproved }, jobRows] = await Promise.all([
    getJobCostsForJob(jobId),
    db.select({ salePriceTotal: jobs.salePriceTotal }).from(jobs).where(eq(jobs.id, jobId)).limit(1),
  ]);

  const revenue = jobRows[0]?.salePriceTotal ?? null;
  const confirmedCost = totalApproved;

  if (revenue === null) {
    return { revenue: null, confirmedCost, grossProfit: null, marginPercent: null };
  }

  const grossProfit = subtractMoney(revenue, confirmedCost);
  const marginPercent =
    compareMoney(revenue, "0.00") === 0
      ? null
      : (Number(grossProfit) / Number(revenue)) * 100;

  return { revenue, confirmedCost, grossProfit, marginPercent };
}

/** Cost categories that MUST be entered through addJobCostAction (never auto-booked). */
export const MANUAL_JOB_COST_CATEGORIES = [
  "hardware",
  "external_contractor",
  "aluminum_contractor",
  "other",
] as const;
export type ManualJobCostCategory = (typeof MANUAL_JOB_COST_CATEGORIES)[number];
