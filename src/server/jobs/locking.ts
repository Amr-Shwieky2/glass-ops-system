import "server-only";
import { eq } from "drizzle-orm";
import { jobs, jobStatuses } from "@/server/db/schema";
import type { Database } from "@/server/db/client";

export interface LockedJobRow {
  isTerminal: boolean;
  sourceQuoteVersionId: string | null;
}

/**
 * Locks a single job row for the rest of the current transaction
 * (`SELECT ... FOR UPDATE OF jobs`) and returns the two fields every
 * job-mutating write in this file's callers needs to re-check AFTER
 * acquiring the lock: whether the job is terminal, and which quote
 * version (if any) it was last converted from.
 *
 * Why this exists: convertQuoteToJob (manual "تحويل إلى مهمة"),
 * sendToFactoryAction (manual "إرسال إلى المصنع"), and
 * runPostSignAutomation's automatic mirror of both (src/server/quotes/
 * actions.ts) each used to do a plain "SELECT to check, then INSERT/UPDATE"
 * with no locking — so a staff member's manual click and the customer's
 * signature triggering the automatic path could both pass their "not yet
 * done" check before either commits, racing each other. Locking the job
 * row here (and `of: jobs` specifically — never jobStatuses, a small
 * shared lookup table whose rows must stay free for unrelated jobs) forces
 * every one of those callers to run its check-then-act sequence one at a
 * time per job, so the loser of a race sees the winner's already-committed
 * state instead of overwriting it.
 *
 * `tx` must already be inside a transaction. Returns null if the job
 * doesn't exist (defense in depth — every caller already validated this
 * before opening the transaction in the non-racing case).
 */
export async function lockJobForWrite(
  tx: Database,
  jobId: string,
): Promise<LockedJobRow | null> {
  const [row] = await tx
    .select({
      isTerminal: jobStatuses.isTerminal,
      sourceQuoteVersionId: jobs.sourceQuoteVersionId,
    })
    .from(jobs)
    .innerJoin(jobStatuses, eq(jobs.statusId, jobStatuses.id))
    .where(eq(jobs.id, jobId))
    .for("update", { of: jobs })
    .limit(1);
  return row ?? null;
}
