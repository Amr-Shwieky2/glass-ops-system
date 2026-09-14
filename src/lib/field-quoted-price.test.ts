import { describe, expect, test } from "vitest";
import { formatILS } from "@/server/money";
import { formatFieldQuotedPrice } from "./field-quoted-price";

describe("formatFieldQuotedPrice", () => {
  test("before-VAT label, exactly as design spec section 4's example (amount · label)", () => {
    expect(formatFieldQuotedPrice("2500.00", false)).toBe(`${formatILS("2500.00")} · قبل الضريبة`);
  });

  test("after-VAT label", () => {
    expect(formatFieldQuotedPrice("2500.00", true)).toBe(`${formatILS("2500.00")} · شامل الضريبة`);
  });

  test("no VAT computation ever happens — the raw amount is unchanged by the toggle, only the label differs", () => {
    const before = formatFieldQuotedPrice("1000.00", false);
    const after = formatFieldQuotedPrice("1000.00", true);
    expect(before).toContain("1,000.00");
    expect(after).toContain("1,000.00");
    expect(before).not.toBe(after);
  });

  test("a fractional amount formats to exactly two decimal places", () => {
    expect(formatFieldQuotedPrice("199.90", false)).toBe(`${formatILS("199.90")} · قبل الضريبة`);
  });

  test("a zero amount still formats (server validation rejects it before this point, not this function)", () => {
    expect(formatFieldQuotedPrice("0.00", true)).toBe(`${formatILS("0.00")} · شامل الضريبة`);
  });

  test("swapping the VAT flag never changes the shekel figure itself — a regression this exact scenario once slipped past (only a selector click was asserted, never the rendered text)", () => {
    const price = "3750.50";
    const amountOnly = (s: string) => s.split(" · ")[0];
    expect(amountOnly(formatFieldQuotedPrice(price, false))).toBe(
      amountOnly(formatFieldQuotedPrice(price, true)),
    );
  });
});
