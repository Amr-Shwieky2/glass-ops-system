import { NextResponse } from "next/server";
import { getQuoteByPublicToken } from "@/server/quotes/queries";
import { getAllSettings } from "@/server/settings";
import { renderQuoteHtml } from "@/server/pdf/quote-template";
import { renderHtmlToPdf } from "@/server/pdf/render";
import { checkRateLimit } from "@/server/security/rate-limit";

/**
 * Customer-facing quote PDF (section 18) — gated by the token itself, same
 * as the signing page. Allowed for a not-yet-signed or expired link too
 * (so the customer can print/review before deciding), just not a revoked
 * one; the token can't be enumerated (32 random bytes, see tokens.ts).
 *
 * Rate-limited per token: each call renders a real headless-Chromium PDF,
 * so an unthrottled hit against even one valid link is a cheap way to
 * exhaust server resources (live-demonstrated in the Sprint 0 audit).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const rate = checkRateLimit(`public-quote-pdf:${token}`, {
    maxAttempts: 20,
    windowMs: 5 * 60_000,
    blockMs: 5 * 60_000,
  });
  if (!rate.allowed) {
    return NextResponse.json({ error: "محاولات كثيرة جداً. حاول مرة أخرى بعد قليل." }, { status: 429 });
  }

  const data = await getQuoteByPublicToken(token);
  if (!data || data.isRevoked) {
    return NextResponse.json({ error: "الرابط غير صالح." }, { status: 404 });
  }

  const settings = await getAllSettings();
  const html = renderQuoteHtml({
    companyInfo: settings.company_info,
    language: data.quote.language,
    quoteNumber: data.quote.quoteNumber,
    versionNumber: data.version.versionNumber,
    createdAt: data.version.createdAt,
    validUntil: data.version.validUntil,
    customerName: data.customer?.name ?? "",
    customerPhone: data.customer?.phone,
    customerAddress: data.customer?.address ?? data.job?.address,
    jobNumber: data.job?.jobNumber ?? "",
    jobTitle: data.job?.title,
    items: data.version.items,
    subtotal: data.version.subtotal,
    total: data.version.total,
    paymentTerms: data.version.paymentTerms,
    workTerms: data.version.workTerms,
    notes: data.version.notes,
    signature: data.signature
      ? {
          signedAt: data.signature.signedAt,
          customerNameAtSigning: data.signature.customerNameAtSigning,
          signatureImage: data.signature.signatureImage,
        }
      : null,
  });

  const pdf = await renderHtmlToPdf(html);
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${data.quote.quoteNumber}.pdf"`,
    },
  });
}
