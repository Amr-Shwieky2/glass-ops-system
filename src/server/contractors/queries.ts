import "server-only";
import { desc } from "drizzle-orm";
import { db } from "@/server/db/client";
import { externalContractors } from "@/server/db/schema";

export interface ContractorRow {
  id: string;
  name: string;
  phone: string | null;
  serviceType: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: Date;
}

/** Every contractor, active AND inactive, newest first — the management
 * roster page (src/app/(app)/contractors/page.tsx). Distinct from
 * src/server/jobs/queries.ts's getActiveExternalContractors, which only
 * returns active ones for assignment pickers. */
export async function listContractors(): Promise<ContractorRow[]> {
  return db
    .select({
      id: externalContractors.id,
      name: externalContractors.name,
      phone: externalContractors.phone,
      serviceType: externalContractors.serviceType,
      notes: externalContractors.notes,
      isActive: externalContractors.isActive,
      createdAt: externalContractors.createdAt,
    })
    .from(externalContractors)
    .orderBy(desc(externalContractors.createdAt));
}
