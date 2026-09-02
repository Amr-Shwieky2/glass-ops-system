"use server";

import { getCurrentUser } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { PERMISSIONS } from "@/server/auth/permission-keys";
import { listJobs } from "@/server/jobs/queries";

export interface JobOption {
  id: string;
  jobNumber: string;
  customerName: string;
}

/**
 * Small job search backing this area's optional job-link fields (checks,
 * technician compensation entries) — same RPC-from-onChange shape as
 * searchCustomersAction in src/app/(app)/jobs/customer-combobox.tsx's
 * server action. Respects the same visibility rule as the /jobs list: a
 * viewer without VIEW_ALL_JOBS only searches jobs they're involved in.
 */
export async function searchJobsAction(term: string): Promise<JobOption[]> {
  const user = await getCurrentUser();
  if (!user) return [];
  if (!term || term.trim().length < 2) return [];

  const canViewAll = can(user, PERMISSIONS.VIEW_ALL_JOBS);
  const canViewAssigned = can(user, PERMISSIONS.VIEW_ASSIGNED_JOBS);
  if (!canViewAll && !canViewAssigned) return [];

  const { rows } = await listJobs({
    search: term,
    restrictToUserId: canViewAll ? undefined : user.id,
    limit: 10,
  });

  return rows.map((r) => ({ id: r.id, jobNumber: r.jobNumber, customerName: r.customerName }));
}
