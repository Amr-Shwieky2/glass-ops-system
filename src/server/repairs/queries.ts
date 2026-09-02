import "server-only";
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/server/db/client";
import { repairs, jobs, customers, users } from "@/server/db/schema";

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
 */
export async function getRepairsList(filters?: {
  status?: "open" | "scheduled" | "in_progress" | "resolved";
}): Promise<RepairListRow[]> {
  const query = repairListBaseQuery();
  const rows = await (filters?.status
    ? query.where(eq(repairs.status, filters.status))
    : query
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

/** Count of every unresolved repair (open/scheduled/in_progress) — small
 * dashboard widget. */
export async function getOpenRepairsCount(): Promise<number> {
  const rows = await db
    .select({ id: repairs.id })
    .from(repairs)
    .where(inArray(repairs.status, UNRESOLVED_REPAIR_STATUSES));
  return rows.length;
}

/** Every unresolved repair (open/scheduled/in_progress), newest
 * dateReported first — small dashboard widget listing. */
export async function getOpenRepairs(): Promise<RepairListRow[]> {
  const rows = await repairListBaseQuery()
    .where(inArray(repairs.status, UNRESOLVED_REPAIR_STATUSES))
    .orderBy(desc(repairs.dateReported), desc(repairs.createdAt));
  return rows;
}
