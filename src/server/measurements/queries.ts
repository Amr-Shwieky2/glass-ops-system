import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { glassTypes } from "@/server/db/schema";

/** Active glass types, for the New Measurement quick-submit form's select
 * and for labeling a measurement's glassTypeId elsewhere — same shape and
 * ordering convention as getAllWorkTypes() in src/server/jobs/queries.ts. */
export async function getGlassTypes() {
  return db
    .select()
    .from(glassTypes)
    .where(eq(glassTypes.isActive, true))
    .orderBy(glassTypes.sortOrder);
}
