import { describe, it, expect } from "vitest";
import { computePaymentStatus } from "./payment-status";

describe("computePaymentStatus", () => {
  it("returns null when the job has no sale price yet", () => {
    expect(computePaymentStatus(null, "0.00")).toBeNull();
    expect(computePaymentStatus(null, "500.00")).toBeNull();
  });

  it("returns not_paid when nothing has been paid", () => {
    expect(computePaymentStatus("1000.00", "0.00")).toBe("not_paid");
  });

  it("returns partially_paid when some but not all has been paid", () => {
    expect(computePaymentStatus("1000.00", "1.00")).toBe("partially_paid");
    expect(computePaymentStatus("1000.00", "999.99")).toBe("partially_paid");
  });

  it("returns fully_paid when the paid total exactly matches the sale price", () => {
    expect(computePaymentStatus("1000.00", "1000.00")).toBe("fully_paid");
  });

  it("returns fully_paid when the customer overpaid", () => {
    expect(computePaymentStatus("1000.00", "1000.01")).toBe("fully_paid");
  });

  it("returns fully_paid for a zero-value job with no payments (nothing owed, nothing paid)", () => {
    expect(computePaymentStatus("0.00", "0.00")).toBe("fully_paid");
  });
});
