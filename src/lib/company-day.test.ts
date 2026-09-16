import { describe, it, expect } from "vitest";
import {
  getTodayRangeUtc,
  getTodayDateString,
  parseCompanyDateString,
  addCompanyDays,
  COMPANY_TIMEZONE,
} from "@/lib/company-day";

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

// Sprint 9: these three functions replaced `new Date().toISOString().slice(0, 10)`
// (or an equivalent server-local-day computation) at several call sites that
// each independently drifted a business date by one day for part of every
// day — see docs/requirements-matrix.md's Sprint 9 entry for the full list.
describe("getTodayDateString", () => {
  it("reads the company's local calendar date, not the UTC one — the exact case the anti-pattern this replaces gets wrong", () => {
    // 23:30 UTC on Jan 15 is already Jan 16 locally in Jerusalem (UTC+2).
    // `new Date().toISOString().slice(0, 10)` would return "2026-01-15".
    expect(getTodayDateString(new Date("2026-01-15T23:30:00Z"))).toBe("2026-01-16");
  });

  it("matches the plain UTC calendar date away from the day boundary", () => {
    expect(getTodayDateString(new Date("2026-07-15T10:00:00Z"))).toBe("2026-07-15");
  });
});

describe("parseCompanyDateString", () => {
  it("is the inverse of getTodayDateString — round-trips through the company's own midnight", () => {
    const now = new Date("2026-07-15T10:00:00Z");
    const dateString = getTodayDateString(now);
    expect(getTodayDateString(parseCompanyDateString(dateString))).toBe(dateString);
  });

  it("produces the same UTC instant as getTodayRangeUtc's own start boundary for the same calendar date", () => {
    const now = new Date("2026-01-15T10:00:00Z");
    const { start } = getTodayRangeUtc(now);
    expect(parseCompanyDateString("2026-01-15").getTime()).toBe(start.getTime());
  });
});

describe("addCompanyDays", () => {
  it("with 0 days returns today's own date string", () => {
    const now = new Date("2026-07-15T10:00:00Z");
    expect(addCompanyDays(0, now)).toBe(getTodayDateString(now));
  });

  it("adds whole calendar days, rolling over a month boundary", () => {
    expect(addCompanyDays(20, new Date("2026-01-15T10:00:00Z"))).toBe("2026-02-04");
  });

  it("adds whole calendar days, rolling over a year boundary", () => {
    expect(addCompanyDays(10, new Date("2026-12-28T10:00:00Z"))).toBe("2027-01-07");
  });

  it("matches getTodayDateString's own day-boundary correction — the last hours of a UTC day still count as the next local day when computing the offset", () => {
    // 23:30 UTC on Jan 15 is already Jan 16 in Jerusalem; +1 day from
    // there must land on the 17th, not the 16th a naive UTC-based
    // computation would give.
    expect(addCompanyDays(1, new Date("2026-01-15T23:30:00Z"))).toBe("2026-01-17");
  });
});
