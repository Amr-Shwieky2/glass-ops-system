import "server-only";
import { eq } from "drizzle-orm";
import { jobs, jobStatuses } from "@/server/db/schema";
import type { Database } from "@/server/db/client";

/**
 * The pure forward-only-ordering rule, isolated so it's unit-testable
 * without a live DB connection: a move is only allowed when the target
 * status sorts strictly after the current one. Extracted verbatim from
 * what was previously an inline comparison inside advanceJobStatus below —
 * no behavior change, just a name.
 */
export function isForwardStatusMove(
  currentSortOrder: number,
  targetSortOrder: number,
): boolean {
  return targetSortOrder > currentSortOrder;
}

/**
 * Moves a job to `targetKey` only if that status is FURTHER ALONG than its
 * current one (compared by job_statuses.sort_order) — so a workflow action
 * that nudges status as a side effect (quote sent, quote signed, converted
 * to job...) never rolls a job backward, e.g. re-sending a quote for a
 * paperwork fix after installation is already done. Returns whether it
 * actually moved the job.
 */
export async function advanceJobStatus(
  tx: Database,
  jobId: string,
  targetKey: string,
): Promise<boolean> {
  const [current] = await tx
    .select({ sortOrder: jobStatuses.sortOrder })
    .from(jobs)
    .innerJoin(jobStatuses, eq(jobs.statusId, jobStatuses.id))
    .where(eq(jobs.id, jobId))
    .limit(1);
  const [target] = await tx
    .select({ id: jobStatuses.id, sortOrder: jobStatuses.sortOrder })
    .from(jobStatuses)
    .where(eq(jobStatuses.key, targetKey))
    .limit(1);
  if (!target || !current) return false;
  if (!isForwardStatusMove(current.sortOrder, target.sortOrder)) return false;

  await tx
    .update(jobs)
    .set({ statusId: target.id, updatedAt: new Date() })
    .where(eq(jobs.id, jobId));
  return true;
}
