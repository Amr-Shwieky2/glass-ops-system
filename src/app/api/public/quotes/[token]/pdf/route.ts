import { NextResponse } from "next/server";
import { getQuoteByPublicToken } from "@/server/quotes/queries";
import { getAllSettings } from "@/server/settings";
import { renderQuoteHtml } from "@/server/pdf/quote-template";
import { renderHtmlToPdf } from "@/server/pdf/render";

/**
 * Customer-facing quote PDF (section 18) — gated by the token itself, same
 * as the signing page. Allowed for a not-yet-signed or expired link too
 * (so the customer can print/review before deciding), just not a revoked
 * one; the token can't be enumerated (32 random bytes, see tokens.ts).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
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
