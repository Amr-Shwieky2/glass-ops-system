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
