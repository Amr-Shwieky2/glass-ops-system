import { isZero, isPositive, subtractMoney, type Money } from "@/server/money";

/**
 * Automatic payment status (Sprint 6, R1.18/S6.2/S6.3) — computed purely
 * from a job's `salePriceTotal` and its approved-payments total, never
 * stored as its own column (this codebase's own rule: every financial
 * figure derives from transaction rows at read time, see money.ts and
 * jobs.ts's own doc comment). `null` means the status genuinely does not
 * apply yet — a job with no sale price agreed (not yet quoted/converted)
 * has nothing to be "paid" against, which is a different thing from "not
 * paid" (a priced job where the customer owes everything).
 */
export type PaymentStatus = "not_paid" | "partially_paid" | "fully_paid";

export const PAYMENT_STATUS_LABEL_AR: Record<PaymentStatus, string> = {
  not_paid: "غير مدفوع",
  partially_paid: "مدفوع جزئياً",
  fully_paid: "مدفوع بالكامل",
};

export function computePaymentStatus(
  salePriceTotal: Money | null,
  totalApprovedPaid: Money,
): PaymentStatus | null {
  if (salePriceTotal === null) return null;
  const remaining = subtractMoney(salePriceTotal, totalApprovedPaid);
  // A zero or negative remaining (paid in full, or overpaid) both count as
  // fully paid — checked BEFORE the "nothing paid yet" branch below so a
  // job genuinely priced at exactly ₪0 with ₪0 paid reads as fully paid
  // (nothing owed), not "not paid" (which implies money is still owed).
  if (!isPositive(remaining)) return "fully_paid";
  return isZero(totalApprovedPaid) ? "not_paid" : "partially_paid";
}
