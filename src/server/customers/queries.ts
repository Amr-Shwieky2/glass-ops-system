import "server-only";
import { and, count, desc, eq, exists, ilike, isNull, or, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { customers, jobs, jobStatuses } from "@/server/db/schema";
import { involvementFilter } from "@/server/jobs/queries";

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
