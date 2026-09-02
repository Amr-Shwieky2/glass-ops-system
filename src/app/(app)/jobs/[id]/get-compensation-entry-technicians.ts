import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { technicianLedgerEntries, users } from "@/server/db/schema";

/**
 * Maps each technician_ledger_entries row for a job to the technician's
 * (userId owner's) name. getJobCompensationEntries in
 * src/server/compensation/queries.ts does not join the entry's own
 * userId — only createdByUserName/approvedByUserName — so a job with more
 * than one technician has no way to tell whose earning/bonus/penalty each
 * row is from that query alone. This fills that gap locally (job detail
 * page only), without editing the shared compensation module, per this
 * phase's file-scope restriction (jobs/[id]/ only).
 */
export async function getCompensationEntryTechnicianNames(
  jobId: string,
): Promise<Record<string, string>> {
  const rows = await db
    .select({
      entryId: technicianLedgerEntries.id,
      userName: users.name,
    })
    .from(technicianLedgerEntries)
    .innerJoin(users, eq(technicianLedgerEntries.userId, users.id))
    .where(eq(technicianLedgerEntries.relatedJobId, jobId));

  return Object.fromEntries(rows.map((r) => [r.entryId, r.userName]));
}
