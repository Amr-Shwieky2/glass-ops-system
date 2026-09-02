import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { numberSequences } from "@/server/db/schema";
import type { Database } from "@/server/db/client";

/**
 * Human-readable document numbers (section 80), e.g. JOB-2026-0001. Uses a
 * single atomic UPSERT (INSERT ... ON CONFLICT DO UPDATE ... RETURNING) so
 * two concurrent requests can never be handed the same number — Postgres
 * serializes the row-level update itself, no explicit app-level locking
 * needed.
 */
const PREFIXES = {
  job: "JOB",
  quote: "Q",
  production_request: "PR",
} as const;

export type NumberScope = keyof typeof PREFIXES;

export async function nextDocumentNumber(
  scope: NumberScope,
  executor: Database = db,
): Promise<string> {
  const year = new Date().getFullYear();
  const rows = await executor
    .insert(numberSequences)
    .values({ scope, year, lastValue: 1 })
    .onConflictDoUpdate({
      target: [numberSequences.scope, numberSequences.year],
      set: { lastValue: sql`${numberSequences.lastValue} + 1` },
    })
    .returning({ lastValue: numberSequences.lastValue });

  const value = rows[0].lastValue;
  const padded = String(value).padStart(4, "0");
  return `${PREFIXES[scope]}-${year}-${padded}`;
}
