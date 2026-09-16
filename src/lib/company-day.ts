import { fromZonedTime, toZonedTime } from "date-fns-tz";

/**
 * No existing date-fns-tz usage in the codebase to match (grepped before
 * adding this), so this picks Asia/Jerusalem as the company's operating
 * timezone — the business is based there and this is the one place that
 * decision needs to live for "today" boundaries (My Day, section 41; the
 * dashboard's "today" schedule, section 39/58) to line up with the
 * technicians' actual calendar day rather than the server's UTC day.
 */
export const COMPANY_TIMEZONE = "Asia/Jerusalem";

/**
 * [start, end) of "today" in the company's timezone, expressed as UTC
 * Date instants — the shape every appointment query in this codebase
 * (getMyDayAppointments, getAppointmentsInRange) expects its range in.
 */
export function getTodayRangeUtc(now: Date = new Date()): { start: Date; end: Date } {
  const zonedNow = toZonedTime(now, COMPANY_TIMEZONE);
  const year = zonedNow.getFullYear();
  const month = zonedNow.getMonth();
  const date = zonedNow.getDate();

  const start = fromZonedTime(new Date(year, month, date, 0, 0, 0, 0), COMPANY_TIMEZONE);
  const end = fromZonedTime(new Date(year, month, date + 1, 0, 0, 0, 0), COMPANY_TIMEZONE);
  return { start, end };
}

/**
 * "Today" in the company's timezone as a plain "YYYY-MM-DD" date string —
 * the shape date-stamping columns (e.g. vehicle_responsibility_history's
 * start_date/end_date) expect. Companion to getTodayRangeUtc's UTC-instant
 * range for call sites that need a local calendar date instead. Deliberately
 * NOT `new Date().toISOString().slice(0, 10)` — that reads the UTC date,
 * which drifts a day off the company's actual local date for part of every
 * day (e.g. after local midnight but before UTC midnight, Asia/Jerusalem
 * being ahead of UTC).
 */
export function getTodayDateString(now: Date = new Date()): string {
  const zonedNow = toZonedTime(now, COMPANY_TIMEZONE);
  const year = zonedNow.getFullYear();
  const month = String(zonedNow.getMonth() + 1).padStart(2, "0");
  const date = String(zonedNow.getDate()).padStart(2, "0");
  return `${year}-${month}-${date}`;
}

/**
 * Parses a plain "YYYY-MM-DD" date string (e.g. a `date`-typed column like
 * incoming_checks.due_date) as midnight of that calendar date in the
 * company's timezone, returned as a UTC instant — the counterpart to
 * getTodayDateString for comparing a stored business date against "now"
 * (see isCheckDueSoon). Parsing it as `new Date(dateString + "T00:00:00")`
 * instead (no explicit zone) would read it in the server process's own
 * timezone, which drifts from the company's actual calendar day exactly
 * like the getTodayDateString doc comment above describes.
 */
export function parseCompanyDateString(dateString: string): Date {
  const [year, month, date] = dateString.split("-").map(Number);
  return fromZonedTime(new Date(year, month - 1, date, 0, 0, 0, 0), COMPANY_TIMEZONE);
}

/**
 * A "YYYY-MM-DD" date string `days` calendar days after "today" in the
 * company's timezone (e.g. a quote's default validity window). Adds whole
 * calendar days in the company's own zone via the same `date + days`
 * rollover trick getTodayRangeUtc's own `end` boundary uses, rather than a
 * fixed `days * 86_400_000` millisecond offset — a fixed-ms offset can
 * land on the wrong calendar day across a DST transition.
 */
export function addCompanyDays(days: number, now: Date = new Date()): string {
  const zonedNow = toZonedTime(now, COMPANY_TIMEZONE);
  const year = zonedNow.getFullYear();
  const month = zonedNow.getMonth();
  const date = zonedNow.getDate();
  const target = fromZonedTime(new Date(year, month, date + days, 0, 0, 0, 0), COMPANY_TIMEZONE);
  return getTodayDateString(target);
}
