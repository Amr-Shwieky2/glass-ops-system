import "server-only";
import { and, count, desc, eq, ilike, isNull, or } from "drizzle-orm";
import { db } from "@/server/db/client";
import { customers, jobs, jobStatuses } from "@/server/db/schema";

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
}): Promise<{ rows: CustomerListRow[]; total: number }> {
  const { search, limit = 50, offset = 0 } = params;

  const conditions = [isNull(customers.deletedAt)];
  const term = search?.trim();
  if (term) {
    const pattern = `%${term}%`;
    conditions.push(
      or(ilike(customers.name, pattern), ilike(customers.phone, pattern))!,
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
