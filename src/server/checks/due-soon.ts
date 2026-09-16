import { getTodayRangeUtc, parseCompanyDateString } from "@/lib/company-day";

/**
 * Whether a check's due date is within `thresholdDays` of today (section
 * 39). Deliberately also true for an already-overdue check (a negative
 * day count) — an overdue check is at least as urgent as a "due soon" one,
 * and the UI stage uses this single helper for both the automatic
 * incoming-check status ('future' -> 'due_soon') and highlighting either
 * kind of check regardless of its stored status. Both sides of the diff
 * are pinned to the company's own timezone (Sprint 9) — comparing against
 * the server process's local midnight instead drifts the boundary by a
 * few hours whenever the deployment isn't itself running in Asia/Jerusalem.
 *
 * Kept in its own DB-free module (no `server-only`, no drizzle imports) —
 * unlike the rest of src/server/checks/queries.ts — so this pure date
 * logic stays directly unit-testable without dragging in a live database
 * connection at import time (see due-soon.test.ts).
 */
export function isCheckDueSoon(
  dueDate: string | Date,
  thresholdDays: number,
  now: Date = new Date(),
): boolean {
  const due = typeof dueDate === "string" ? parseCompanyDateString(dueDate) : dueDate;
  const today = getTodayRangeUtc(now).start;
  const diffDays = Math.round((due.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
  return diffDays <= thresholdDays;
}
