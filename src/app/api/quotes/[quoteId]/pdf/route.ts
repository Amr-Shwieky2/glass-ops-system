import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { PERMISSIONS } from "@/server/auth/permission-keys";
import { getJobDetail } from "@/server/jobs/queries";
import { getQuoteRenderData } from "@/server/quotes/queries";
import { getAllSettings } from "@/server/settings";
import { renderQuoteHtml } from "@/server/pdf/quote-template";
import { renderHtmlToPdf } from "@/server/pdf/render";

/**
 * Employee-facing quote PDF. Gated exactly like the job detail page itself
 * (VIEW_ALL_JOBS, or personal involvement in the job) — a Route Handler is
 * outside proxy.ts's matcher (see proxy.ts's comment), so this check is the
 * ONLY thing standing between an authenticated-but-uninvolved user and
 * someone else's quote.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ quoteId: string }> },
) {
  const { quoteId } = await params;
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "يجب تسجيل الدخول." }, { status: 401 });
  }

  const data = await getQuoteRenderData(quoteId);
  if (!data) {
    return NextResponse.json({ error: "عرض السعر غير موجود." }, { status: 404 });
  }

  const job = await getJobDetail(data.quote.jobId);
  if (!job) {
    return NextResponse.json({ error: "المهمة غير موجودة." }, { status: 404 });
  }
  const isInvolved =
    job.measuredByUserId === user.id ||
    job.pricingResponsibleUserId === user.id ||
    job.dealClosedByUserId === user.id ||
    job.assignments.some((a) => a.userId === user.id);
  if (!can(user, PERMISSIONS.VIEW_ALL_JOBS) && !isInvolved) {
    return NextResponse.json({ error: "لا تملك صلاحية الوصول." }, { status: 403 });
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
    customerAddress: data.customer?.address ?? job.address,
    jobNumber: job.jobNumber,
    jobTitle: job.title,
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
