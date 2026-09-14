import "server-only";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import { db } from "@/server/db/client";
import { repairs, jobs, customers, users } from "@/server/db/schema";
import { involvementFilter } from "@/server/jobs/queries";

/** Statuses that mean a repair is still open work — see repairs.ts's own
 * schema comment: any row in one of these statuses must stay visible on
 * the management dashboard. */
const UNRESOLVED_REPAIR_STATUSES = ["open", "scheduled", "in_progress"] as const;

export interface Repair {
  id: string;
  jobId: string;
  problemDescription: string;
  dateReported: string;
  responsibleUserId: string | null;
  scheduledDate: string | null;
  status: "open" | "scheduled" | "in_progress" | "resolved";
  notes: string | null;
  resolvedAt: Date | null;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RepairListRow extends Repair {
  jobNumber: string;
  customerName: string;
  responsibleUserName: string | null;
}

const repairListSelection = {
  id: repairs.id,
  jobId: repairs.jobId,
  problemDescription: repairs.problemDescription,
  dateReported: repairs.dateReported,
  responsibleUserId: repairs.responsibleUserId,
  scheduledDate: repairs.scheduledDate,
  status: repairs.status,
  notes: repairs.notes,
  resolvedAt: repairs.resolvedAt,
  createdByUserId: repairs.createdByUserId,
  createdAt: repairs.createdAt,
  updatedAt: repairs.updatedAt,
  jobNumber: jobs.jobNumber,
  customerName: customers.name,
  responsibleUserName: users.name,
};

/** A restricted viewer sees a repair if they're involved in its job
 * (measured/priced/closed/assigned) OR are the repair's own responsible
 * person — the latter was previously missing everywhere this file scopes
 * by user (Sprint 1 fix: a technician set as a repair's sole responsible
 * person could not see it on their own dashboard, since involvementFilter
 * alone only looks at the parent job, not the repair row itself). */
function repairVisibilityFilter(restrictToUserId: string) {
  return or(involvementFilter(restrictToUserId), eq(repairs.responsibleUserId, restrictToUserId))!;
}

function repairListBaseQuery() {
  return db
    .select(repairListSelection)
    .from(repairs)
    .innerJoin(jobs, eq(repairs.jobId, jobs.id))
    .innerJoin(customers, eq(jobs.customerId, customers.id))
    .leftJoin(users, eq(repairs.responsibleUserId, users.id));
}

/**
 * Every repair (across all jobs), newest dateReported first, with job
 * number + customer name joined — backs the standalone /repairs list page.
 * `restrictToUserId` (Sprint 1 security hardening): a VIEW_ASSIGNED_JOBS-
 * only viewer used to see every company repair here regardless of
 * involvement — live-demonstrated during the Sprint 0 audit against a
 * 7-permission installer account. Pass it whenever the caller lacks
 * VIEW_ALL_JOBS, same convention as listJobs/listCustomers.
 */
export async function getRepairsList(filters?: {
  status?: "open" | "scheduled" | "in_progress" | "resolved";
  restrictToUserId?: string;
}): Promise<RepairListRow[]> {
  const conditions = [
    ...(filters?.status ? [eq(repairs.status, filters.status)] : []),
    ...(filters?.restrictToUserId ? [repairVisibilityFilter(filters.restrictToUserId)] : []),
  ];
  const rows = await (conditions.length > 0
    ? repairListBaseQuery().where(and(...conditions))
    : repairListBaseQuery()
  ).orderBy(desc(repairs.dateReported), desc(repairs.createdAt));
  return rows;
}

/** Every repair for one job, for the Job detail page's repairs section. */
export async function getJobRepairs(jobId: string): Promise<Repair[]> {
  return db
    .select({
      id: repairs.id,
      jobId: repairs.jobId,
      problemDescription: repairs.problemDescription,
      dateReported: repairs.dateReported,
      responsibleUserId: repairs.responsibleUserId,
      scheduledDate: repairs.scheduledDate,
      status: repairs.status,
      notes: repairs.notes,
      resolvedAt: repairs.resolvedAt,
      createdByUserId: repairs.createdByUserId,
      createdAt: repairs.createdAt,
      updatedAt: repairs.updatedAt,
    })
    .from(repairs)
    .where(eq(repairs.jobId, jobId))
    .orderBy(desc(repairs.dateReported), desc(repairs.createdAt));
}

/**
 * Count of every unresolved repair (open/scheduled/in_progress) — small
 * dashboard widget. When `restrictToUserId` is set (viewer only has
 * VIEW_ASSIGNED_JOBS, not VIEW_ALL_JOBS), scoped to jobs that user is
 * involved in — same involvementFilter used by the dashboard's other
 * per-item lists (readyWithoutInstall, todayAppointmentRows) — so this
 * widget never discloses job/customer identity for a job the viewer is
 * not otherwise allowed to open.
 */
export async function getOpenRepairsCount(restrictToUserId?: string): Promise<number> {
  const rows = await db
    .select({ id: repairs.id })
    .from(repairs)
    .innerJoin(jobs, eq(repairs.jobId, jobs.id))
    .where(
      and(
        inArray(repairs.status, UNRESOLVED_REPAIR_STATUSES),
        ...(restrictToUserId ? [repairVisibilityFilter(restrictToUserId)] : []),
      ),
    );
  return rows.length;
}

/** Every unresolved repair (open/scheduled/in_progress), newest
 * dateReported first — small dashboard widget listing. Scoped the same
 * way as getOpenRepairsCount above when `restrictToUserId` is set. */
export async function getOpenRepairs(restrictToUserId?: string): Promise<RepairListRow[]> {
  const rows = await repairListBaseQuery()
    .where(
      and(
        inArray(repairs.status, UNRESOLVED_REPAIR_STATUSES),
        ...(restrictToUserId ? [repairVisibilityFilter(restrictToUserId)] : []),
      ),
    )
    .orderBy(desc(repairs.dateReported), desc(repairs.createdAt));
  return rows;
}
