import { describe, it, expect } from "vitest";
import { isCheckDueSoon } from "./due-soon";
import { getTodayRangeUtc } from "@/lib/company-day";

describe("isCheckDueSoon", () => {
  it("is true for a check due today", () => {
    const now = new Date("2026-07-15T10:00:00Z");
    expect(isCheckDueSoon("2026-07-15", 7, now)).toBe(true);
  });

  it("is true for a check due within the threshold", () => {
    const now = new Date("2026-07-15T10:00:00Z");
    expect(isCheckDueSoon("2026-07-20", 7, now)).toBe(true);
  });

  it("is false for a check due beyond the threshold", () => {
    const now = new Date("2026-07-15T10:00:00Z");
    expect(isCheckDueSoon("2026-07-25", 7, now)).toBe(false);
  });

  it("is true for an already-overdue check regardless of threshold", () => {
    const now = new Date("2026-07-15T10:00:00Z");
    expect(isCheckDueSoon("2026-07-01", 0, now)).toBe(true);
  });

  it("uses the company's own calendar day boundary, not the server-local one — the exact bug this replaced", () => {
    // At 23:30 UTC on July 14, Jerusalem local time is already July 15
    // (UTC+3 in summer). A check due "2026-07-15" is due THAT DAY in
    // Jerusalem terms, so isDueSoon(0) must be true — the old
    // implementation (comparing against `new Date(); setHours(0,0,0,0)`,
    // the SERVER's own local midnight) would get this wrong on any
    // deployment not itself running in Asia/Jerusalem, e.g. a UTC server
    // would still think it's "July 14" for another 30 minutes and see
    // the check as one day away, not due today.
    const now = new Date("2026-07-14T23:30:00Z");
    expect(isCheckDueSoon("2026-07-15", 0, now)).toBe(true);
  });

  it("accepts a Date directly — compared as the exact instant given, not re-derived from a calendar date", () => {
    const now = new Date("2026-07-15T10:00:00Z");
    // Jerusalem midnight for "today", expressed as a UTC instant — the
    // same shape parseCompanyDateString itself produces for a string.
    const dueAtTodaysCompanyMidnight = getTodayRangeUtc(now).start;
    expect(isCheckDueSoon(dueAtTodaysCompanyMidnight, 0, now)).toBe(true);
  });
});
