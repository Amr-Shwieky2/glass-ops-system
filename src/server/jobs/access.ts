import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { jobs } from "@/server/db/schema";
import { can } from "@/server/auth/permissions";
import { PERMISSIONS } from "@/server/auth/permission-keys";
import type { AuthedUser } from "@/server/auth/session";
import { isJobVisibleToUser } from "@/server/jobs/queries";

/**
 * The one shared "may this user act on this job" check for every
 * job-scoped Server Action — factored out after a repository-wide audit
 * (master execution prompt: "audit and repair every job-scoped/child-
 * entity Server Action so possession of a general permission is not
 * enough to mutate an arbitrary Job UUID") found the same missing check
 * repeated across createMeasurement, addJobItem, deleteJobItem,
 * assignToJob, removeAssignment, cancelJob, closeJobAction,
 * scheduleAppointmentAction, addPaymentAction, addJobCostAction,
 * sendQuoteAction, convertQuoteToJob, createRepairAction,
 * sendToFactoryAction, allocateInstallationEarning, and both commission
 * actions — every one of them held a permission-key check but never
 * verified the caller could actually SEE the specific job UUID they were
 * about to mutate. A Server Action is a public RPC endpoint regardless of
 * which UI calls it with which jobId, so this must be independently
 * re-derived here, not assumed from "the button was only shown on a page
 * the caller could open."
 *
 * VIEW_ALL_JOBS bypasses the involvement check entirely (but the job must
 * still exist); otherwise the same involvementFilter /jobs/[id] itself
 * uses to decide Forbidden is applied. Returns a user-facing Arabic error
 * string when access should be denied, null when it's fine — callers
 * `const err = await assertJobVisible(user, jobId); if (err) return { error: err };`.
 */
export async function assertJobVisible(
  user: AuthedUser | null,
  jobId: string,
): Promise<string | null> {
  if (!user) return "يجب تسجيل الدخول.";

  if (can(user, PERMISSIONS.VIEW_ALL_JOBS)) {
    const [row] = await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.id, jobId)).limit(1);
    return row ? null : "المهمة غير موجودة.";
  }

  if (await isJobVisibleToUser(jobId, user.id)) return null;
  return "لا تملك صلاحية الوصول إلى هذه المهمة.";
}
