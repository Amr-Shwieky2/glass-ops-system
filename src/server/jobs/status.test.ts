import { describe, it, expect } from "vitest";
import { isForwardStatusMove } from "@/server/jobs/status";

/**
 * advanceJobStatus() itself is intentionally NOT unit-tested here — it
 * takes a live Drizzle transaction (`tx`) and does two real SELECTs plus
 * an UPDATE against Postgres before applying this rule, so exercising it
 * meaningfully requires a real database. Per AGENTS.md's own guidance for
 * this phase ("do not risk destabilizing a function every other phase's
 * server actions call"), that DB-coupled function was left untouched;
 * only the pure sort-order comparison it already made inline was pulled
 * out into isForwardStatusMove() (see src/server/jobs/status.ts) — same
 * behavior, now independently testable.
 *
 * advanceJobStatus's real, DB-backed forward-only guard is already
 * exercised end-to-end by the Playwright suite (the Ahmad scenario moves
 * a job through several statuses and asserts it can't go backward) and by
 * multiple scripts/verify-phaseN.mjs scripts (phase 6 and 7 both drive
 * real status transitions against the live DB and assert a backward move
 * is rejected) — see this phase's report for the full list.
 */
describe("isForwardStatusMove", () => {
  it("allows a move to a strictly later sort order", () => {
    expect(isForwardStatusMove(1, 2)).toBe(true);
    expect(isForwardStatusMove(1, 10)).toBe(true);
  });

  it("rejects a move to the same sort order (no-op, not an error)", () => {
    expect(isForwardStatusMove(5, 5)).toBe(false);
  });

  it("rejects a move to an earlier sort order (would roll the job backward)", () => {
    expect(isForwardStatusMove(5, 4)).toBe(false);
    expect(isForwardStatusMove(10, 1)).toBe(false);
  });

  it("handles negative/zero sort orders the same way (no assumption they start at 1)", () => {
    expect(isForwardStatusMove(0, 1)).toBe(true);
    expect(isForwardStatusMove(-1, 0)).toBe(true);
    expect(isForwardStatusMove(0, -1)).toBe(false);
  });
});
