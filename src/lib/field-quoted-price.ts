import { formatILS, type Money } from "@/server/money";

/**
 * The New Measurement quick-submit flow's reference price, formatted for
 * display exactly as design spec section 4 specifies: "amount ·
 * before/after-VAT label" (e.g. "₪2,500.00 · شامل الضريبة"). No VAT
 * computation happens here or anywhere in this flow — the raw amount and
 * the toggle's before/after state are simply stored and displayed as
 * entered; real VAT math, if any, happens later in the formal quote.
 */
export function formatFieldQuotedPrice(price: Money, includesVat: boolean): string {
  const vatLabel = includesVat ? "شامل الضريبة" : "قبل الضريبة";
  return `${formatILS(price)} · ${vatLabel}`;
}
