import { describe, it, expect } from "vitest";
import { normalizePhone, isPlausiblePhone } from "@/server/tokens";

/**
 * normalizePhone/isPlausiblePhone had no unit coverage before this phase
 * (checked: no existing src/**\/*.test.ts references either). They matter
 * here specifically because the New Measurement quick-submit flow's
 * find-or-create-by-phone customer lookup (src/server/measurements/
 * actions.ts's submitFieldMeasurementAction) keys entirely off
 * normalizePhone's output — two submissions must normalize to the exact
 * same string for the "reuse the existing customer" behavior (and the
 * partial unique index + onConflictDoNothing race-safety built on top of
 * it) to work at all. That DB-coupled find-or-create behavior itself
 * (including the onConflictDoNothing race fix) is correctly a Playwright/
 * integration-level concern — see tests/e2e/new-measurement.spec.ts —
 * this file only covers the pure normalization/validation step.
 *
 * generateSecureToken/hashToken are not covered here: they're thin,
 * behaviorally-trivial wrappers around Node's own crypto primitives
 * (randomBytes/createHash) with no branching logic of this module's own to
 * verify.
 */

describe("normalizePhone", () => {
  it("converts a local Israeli 05x number to +972 form, dropping the trunk zero", () => {
    expect(normalizePhone("0501234567")).toBe("+972501234567");
  });

  it("strips dashes/spaces/parentheses formatting from a local number", () => {
    expect(normalizePhone("050-123-4567")).toBe("+972501234567");
    expect(normalizePhone("(050) 123 4567")).toBe("+972501234567");
  });

  it("trims surrounding whitespace before checking for a leading +", () => {
    expect(normalizePhone("  0501234567  ")).toBe("+972501234567");
  });

  it("keeps an already-international +972 number, just stripping formatting", () => {
    expect(normalizePhone("+972-50-123-4567")).toBe("+972501234567");
  });

  it("keeps a non-Israeli international number's + and digits as-is", () => {
    expect(normalizePhone("+1 (555) 000-1111")).toBe("+15550001111");
  });

  it("drops a + that isn't the very first character (not treated as international)", () => {
    // Same convention as src/lib/location-links.ts's buildTelHref for the
    // same edge case: only a genuinely leading + counts.
    expect(normalizePhone("050+1234567")).toBe("+972501234567");
  });

  it("assumes +972 for digits with no leading 0 and no +, per this module's own documented default", () => {
    expect(normalizePhone("501234567")).toBe("+501234567");
  });

  it("returns an empty string when there are no digits at all", () => {
    expect(normalizePhone("abc")).toBe("");
    expect(normalizePhone("")).toBe("");
    expect(normalizePhone("   ")).toBe("");
  });

  it("normalizes two different-looking inputs for the same number to the identical string (dedup precondition)", () => {
    // This is exactly the property the field-measurement find-or-create
    // customer lookup depends on: a technician who types "0501234567" one
    // day and "+972-50-123-4567" (or "050 123 4567") another day must
    // resolve to the same customer, not a duplicate.
    const a = normalizePhone("0501234567");
    const b = normalizePhone("+972-50-123-4567");
    const c = normalizePhone("050 123 4567");
    expect(a).toBe(b);
    expect(b).toBe(c);
  });
});

describe("isPlausiblePhone", () => {
  it("accepts a normal local Israeli number", () => {
    expect(isPlausiblePhone("0501234567")).toBe(true);
  });

  it("accepts a normal international number", () => {
    expect(isPlausiblePhone("+15550001111")).toBe(true);
  });

  it("accepts the shortest plausible length (8 digits after +, boundary)", () => {
    expect(isPlausiblePhone("+12345678")).toBe(true);
  });

  it("rejects one digit short of the minimum (7 digits after +, boundary)", () => {
    expect(isPlausiblePhone("+1234567")).toBe(false);
  });

  it("accepts the longest plausible length (15 digits after +, boundary)", () => {
    expect(isPlausiblePhone("+123456789012345")).toBe(true);
  });

  it("rejects one digit past the maximum (16 digits after +, boundary)", () => {
    expect(isPlausiblePhone("+1234567890123456")).toBe(false);
  });

  it("rejects empty/garbage input with no digits", () => {
    expect(isPlausiblePhone("")).toBe(false);
    expect(isPlausiblePhone("abc")).toBe(false);
    expect(isPlausiblePhone("   ")).toBe(false);
  });

  it("rejects a too-short number even with valid formatting", () => {
    expect(isPlausiblePhone("123")).toBe(false);
  });
});
