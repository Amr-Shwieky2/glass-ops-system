import "server-only";
import { and, eq, ilike, isNull, or } from "drizzle-orm";
import { db } from "@/server/db/client";
import { customers, jobs, jobStatuses } from "@/server/db/schema";
import type { AuthedUser } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { PERMISSIONS } from "@/server/auth/permission-keys";

export interface GlobalSearchResults {
  customers: { id: string; name: string; phone: string }[];
  jobs: {
    id: string;
    jobNumber: string;
    customerName: string;
    statusLabelAr: string;
  }[];
}

/** Global search (section 65-ish) — customers by name/phone, jobs by
 * number or customer name/phone. Respects the same view permissions as
 * the dedicated list pages: a viewer with neither VIEW_CUSTOMERS nor any
 * job-view permission gets empty results, not an error. */
export async function globalSearch(
  user: AuthedUser | null,
  term: string,
): Promise<GlobalSearchResults> {
  const trimmed = term.trim();
  if (trimmed.length < 2) return { customers: [], jobs: [] };
  const pattern = `%${trimmed}%`;

  const canSeeCustomers = can(user, PERMISSIONS.VIEW_CUSTOMERS);
  const canSeeJobs =
    can(user, PERMISSIONS.VIEW_ALL_JOBS) || can(user, PERMISSIONS.VIEW_ASSIGNED_JOBS);

  const [customerRows, jobRows] = await Promise.all([
    canSeeCustomers
      ? db
          .select({ id: customers.id, name: customers.name, phone: customers.phone })
          .from(customers)
          .where(
            and(
              isNull(customers.deletedAt),
              or(ilike(customers.name, pattern), ilike(customers.phone, pattern)),
            ),
          )
          .limit(8)
      : Promise.resolve([]),
    canSeeJobs
      ? db
          .select({
            id: jobs.id,
            jobNumber: jobs.jobNumber,
            customerName: customers.name,
            statusLabelAr: jobStatuses.labelAr,
          })
          .from(jobs)
          .innerJoin(customers, eq(jobs.customerId, customers.id))
          .innerJoin(jobStatuses, eq(jobs.statusId, jobStatuses.id))
          .where(
            and(
              isNull(jobs.deletedAt),
              or(
                ilike(jobs.jobNumber, pattern),
                ilike(customers.name, pattern),
                ilike(customers.phone, pattern),
              ),
            ),
          )
          .limit(8)
      : Promise.resolve([]),
  ]);

  return { customers: customerRows, jobs: jobRows };
}
