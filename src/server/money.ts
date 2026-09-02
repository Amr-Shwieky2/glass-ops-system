/**
 * All money in this system moves through here. Postgres `numeric` columns
 * come back from the driver as strings (never JS floats) specifically to
 * avoid floating-point rounding errors (section 73/76) — this module is
 * the only place that does arithmetic on them, via decimal.js, and always
 * converts back to a fixed 2-decimal string before it touches the database
 * or an API response.
 *
 * Never write `a + b` on two money values anywhere else in the codebase.
 */
import Decimal from "decimal.js";

export type Money = string; // a numeric(12,2)-shaped string, e.g. "1234.50"

export function toDecimal(value: Money | number | Decimal): Decimal {
  if (value instanceof Decimal) return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new InvalidMoneyError(`Not a finite number: ${value}`);
    }
    return new Decimal(value);
  }
  const trimmed = value.trim();
  if (trimmed === "" || !/^-?\d+(\.\d+)?$/.test(trimmed)) {
    throw new InvalidMoneyError(`Not a valid money string: "${value}"`);
  }
  return new Decimal(trimmed);
}

export class InvalidMoneyError extends Error {}

/** Round-trips through decimal.js and fixes to 2 decimals for storage. */
export function money(value: Money | number | Decimal): Money {
  return toDecimal(value).toFixed(2);
}

export function addMoney(...values: (Money | number | Decimal)[]): Money {
  return values
    .reduce<Decimal>((acc, v) => acc.plus(toDecimal(v)), new Decimal(0))
    .toFixed(2);
}

export function subtractMoney(
  a: Money | number | Decimal,
  b: Money | number | Decimal,
): Money {
  return toDecimal(a).minus(toDecimal(b)).toFixed(2);
}

export function multiplyMoney(
  a: Money | number | Decimal,
  b: Money | number | Decimal,
): Money {
  return toDecimal(a).times(toDecimal(b)).toFixed(2);
}

export function sumMoney(values: (Money | number | Decimal)[]): Money {
  if (values.length === 0) return "0.00";
  return addMoney(...values);
}

export function isZero(value: Money | number | Decimal): boolean {
  return toDecimal(value).isZero();
}

export function isNegative(value: Money | number | Decimal): boolean {
  return toDecimal(value).isNegative();
}

export function isPositive(value: Money | number | Decimal): boolean {
  return toDecimal(value).isPositive() && !toDecimal(value).isZero();
}

export function compareMoney(
  a: Money | number | Decimal,
  b: Money | number | Decimal,
): -1 | 0 | 1 {
  return toDecimal(a).comparedTo(toDecimal(b)) as -1 | 0 | 1;
}

/**
 * Validates untrusted user input (a form field) into a Money string.
 * Returns null instead of throwing — callers report this as a normal
 * validation error, not a 500.
 */
export function parseMoneyInput(raw: unknown): Money | null {
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return null;
    return new Decimal(raw).toFixed(2);
  }
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().replace(/,/g, "");
  if (trimmed === "" || !/^-?\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  try {
    return new Decimal(trimmed).toFixed(2);
  } catch {
    return null;
  }
}

/** Same as parseMoneyInput but rejects negative amounts (most form fields). */
export function parseNonNegativeMoneyInput(raw: unknown): Money | null {
  const parsed = parseMoneyInput(raw);
  if (parsed === null) return null;
  return isNegative(parsed) ? null : parsed;
}

/**
 * Display formatting. Deliberately forces `numberingSystem: "latn"` (plain
 * 0-9 digits) even though the UI's primary language is Arabic — financial
 * amounts should never be ambiguous between Arabic-Indic and Western
 * digits, and Western digits are what this business already uses on paper.
 */
const ilsFormatter = new Intl.NumberFormat("ar", {
  style: "currency",
  currency: "ILS",
  currencyDisplay: "symbol",
  numberingSystem: "latn",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatILS(value: Money | number | Decimal): string {
  return ilsFormatter.format(toDecimal(value).toNumber());
}
