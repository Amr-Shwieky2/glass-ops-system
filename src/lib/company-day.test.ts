import { describe, it, expect } from "vitest";
import { getTodayRangeUtc, COMPANY_TIMEZONE } from "@/lib/company-day";

describe("COMPANY_TIMEZONE", () => {
  it("is Asia/Jerusalem", () => {
    expect(COMPANY_TIMEZONE).toBe("Asia/Jerusalem");
  });
});

describe("getTodayRangeUtc", () => {
  it("returns a [start, end) 24h range in UTC, standard-time offset (winter, UTC+2)", () => {
    const { start, end } = getTodayRangeUtc(new Date("2026-01-15T10:00:00Z"));
    expect(start.toISOString()).toBe("2026-01-14T22:00:00.000Z");
    expect(end.toISOString()).toBe("2026-01-15T22:00:00.000Z");
    expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it("returns a [start, end) 24h range in UTC, daylight-saving offset (summer, UTC+3)", () => {
    const { start, end } = getTodayRangeUtc(new Date("2026-07-15T10:00:00Z"));
    expect(start.toISOString()).toBe("2026-07-14T21:00:00.000Z");
    expect(end.toISOString()).toBe("2026-07-15T21:00:00.000Z");
    expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it("uses the company's local day boundary, not the UTC day boundary", () => {
    // 23:30 UTC on Jan 15 is already 01:30 local time on Jan 16 in
    // Jerusalem (UTC+2) — "today" must be the 16th locally, not the 15th
    // as a naive UTC-day computation would give.
    const { start, end } = getTodayRangeUtc(new Date("2026-01-15T23:30:00Z"));
    expect(start.toISOString()).toBe("2026-01-15T22:00:00.000Z");
    expect(end.toISOString()).toBe("2026-01-16T22:00:00.000Z");
  });

  it("defaults `now` to the current time when called with no argument", () => {
    const before = Date.now();
    const { start, end } = getTodayRangeUtc();
    const after = Date.now();
    expect(start.getTime()).toBeLessThanOrEqual(after);
    expect(end.getTime()).toBeGreaterThan(before);
    expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000);
  });
});
