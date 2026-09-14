import { FileText, CheckCircle2 } from "lucide-react";
import { formatILS } from "@/server/money";
import { unitLabelAr } from "@/lib/units";
import { QUOTE_STATUS_LABEL, quoteStatusVariant } from "@/lib/quote-status-style";
import type { QuoteForJob } from "@/server/quotes/queries";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { QuoteBuilderDialog, type QuoteBuilderItem } from "./quote-builder-dialog";
import { AiQuoteDraftTrigger } from "./ai-quote-draft-trigger";
import { SendQuoteButton } from "./send-quote-button";
import { ConvertToJobButton } from "./convert-to-job-button";

const dateFmt = new Intl.DateTimeFormat("ar", {
  year: "numeric",
  month: "short",
  day: "numeric",
  numberingSystem: "latn",
});

interface JobItemForPrefill {
  description: string | null;
  quantity: string;
  unit: string | null;
  salePrice: string | null;
  workTypeLabelAr?: string | null;
}

/** Best-effort starting point for a brand-new quote from the job's existing
 * price-only items (section 21 -> 19 handoff). job_items stores a single
 * salePrice per row treated as that row's LINE total (see the itemsTotal
 * computation just above this section on the page) — so the per-unit price
 * the quote builder wants is derived by dividing it back out; the pricing
 * person can freely adjust it either way before saving. */
function deriveQuoteItemsFromJobItems(items: JobItemForPrefill[]): QuoteBuilderItem[] {
  return items.map((item) => {
    const qty = Number(item.quantity) || 1;
    const price = Number(item.salePrice ?? 0);
    const unitPrice = qty > 0 && item.salePrice ? (price / qty).toFixed(2) : (item.salePrice ?? "0.00");
    return {
      description: item.description || item.workTypeLabelAr || "بند عمل",
      quantity: item.quantity,
      unit: item.unit ?? undefined,
      unitPrice,
    };
  });
}

export function QuoteSection({
  jobId,
  quote,
  jobItems,
  jobSourceQuoteVersionId,
  workTypes,
  customerPhone,
  defaultValidUntil,
  canCreateQuote,
  canSendQuote,
  canCloseDeal,
  canViewSalePrice,
}: {
  jobId: string;
  quote: QuoteForJob | null;
  jobItems: JobItemForPrefill[];
  jobSourceQuoteVersionId: string | null;
  workTypes: { id: string; labelAr: string; defaultUnit: string }[];
  customerPhone?: string | null;
  defaultValidUntil: string;
  canCreateQuote: boolean;
  canSendQuote: boolean;
  canCloseDeal: boolean;
  /** Sprint 1 security hardening: a quote is fundamentally a pricing
   * document — its unit prices/line totals/grand total must never reach a
   * job viewer without pricing visibility, the same gate the job page's
   * own sale-price figures use. Non-price quote metadata (number,
   * version, status, validity, signed badge) stays visible to any job
   * viewer, same treatment as ProductionSection's factory price. */
  canViewSalePrice: boolean;
}) {
  const version = quote?.currentVersion ?? null;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <FileText className="size-5 text-muted-foreground" />
          عرض السعر
          {quote && (
            <Badge variant={quoteStatusVariant(quote.status)}>
              {QUOTE_STATUS_LABEL[quote.status] ?? quote.status}
            </Badge>
          )}
        </CardTitle>
        {canCreateQuote && !quote && (
          <div className="flex flex-wrap items-center gap-2">
            <QuoteBuilderDialog
              jobId={jobId}
              workTypes={workTypes}
              initialItems={
                jobItems.length > 0 ? deriveQuoteItemsFromJobItems(jobItems) : undefined
              }
              initialValidUntil={defaultValidUntil}
              triggerLabel="إنشاء عرض سعر"
            />
            <AiQuoteDraftTrigger
              jobId={jobId}
              workTypes={workTypes}
              initialValidUntil={defaultValidUntil}
            />
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {!quote || !version ? (
          <EmptyState
            title="لم يُنشأ أي عرض سعر بعد"
            description="أنشئ عرض سعر لإرساله للعميل والحصول على توقيعه إلكترونياً."
            className="border-0 p-6"
          />
        ) : (
          <>
            <p className="flex flex-wrap items-center gap-x-1 text-sm text-muted-foreground">
              <span>
                {quote.quoteNumber} · الإصدار {version.versionNumber}
                {version.validUntil && ` · صالح حتى ${dateFmt.format(new Date(version.validUntil))}`}
                {quote.isExpired && " · منتهي الصلاحية"}
              </span>
              {canViewSalePrice && (
                <a
                  href={`/api/quotes/${quote.id}/pdf`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                >
                  · عرض PDF
                </a>
              )}
            </p>

            {canViewSalePrice && (
              <>
                <ul className="divide-y rounded-lg border">
                  {version.items.map((item) => (
                    <li key={item.id} className="flex items-center justify-between p-3 text-sm">
                      <div>
                        <p className="font-medium text-foreground">
                          {item.workTypeLabelAr || item.description}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {item.quantity} {unitLabelAr(item.unit)} × {formatILS(item.unitPrice)}
                        </p>
                      </div>
                      <span dir="ltr" className="font-medium text-foreground">
                        {formatILS(item.lineTotal)}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="flex items-center justify-between text-base font-bold">
                  <span>الإجمالي</span>
                  <span dir="ltr">{formatILS(version.total)}</span>
                </div>
              </>
            )}

            {quote.status === "signed" && (
              <div className="flex items-center gap-2 rounded-lg bg-green-50 p-3 text-sm text-green-800">
                <CheckCircle2 className="size-4 shrink-0" />
                تم توقيع هذا العرض من العميل.
              </div>
            )}

            {quote.versionHistory.length > 1 && (
              <div className="text-xs text-muted-foreground">
                نسخ سابقة:{" "}
                {quote.versionHistory
                  .filter((v) => v.id !== version.id)
                  .map((v) => `#${v.versionNumber}${v.isSigned ? " (موقّعة)" : ""}`)
                  .join("، ")}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 border-t pt-4">
              {canCreateQuote && quote.status !== "signed" && (
                <QuoteBuilderDialog
                  jobId={jobId}
                  quoteId={quote.id}
                  workTypes={workTypes}
                  initialItems={version.items.map((i) => ({
                    workTypeId: i.workTypeId ?? undefined,
                    description: i.description,
                    quantity: i.quantity,
                    unit: i.unit ?? undefined,
                    unitPrice: i.unitPrice,
                  }))}
                  initialPaymentTerms={version.paymentTerms ?? undefined}
                  initialWorkTerms={version.workTerms ?? undefined}
                  initialValidUntil={version.validUntil ?? undefined}
                  initialLanguage={quote.language}
                  triggerLabel={
                    quote.status === "draft" ? "متابعة تحرير المسودة" : "تعديل العرض (نسخة جديدة)"
                  }
                  triggerVariant="outline"
                />
              )}
              {canCreateQuote && quote.status === "signed" && (
                <QuoteBuilderDialog
                  jobId={jobId}
                  quoteId={quote.id}
                  workTypes={workTypes}
                  initialItems={version.items.map((i) => ({
                    workTypeId: i.workTypeId ?? undefined,
                    description: i.description,
                    quantity: i.quantity,
                    unit: i.unit ?? undefined,
                    unitPrice: i.unitPrice,
                  }))}
                  initialPaymentTerms={version.paymentTerms ?? undefined}
                  initialWorkTerms={version.workTerms ?? undefined}
                  initialValidUntil={version.validUntil ?? undefined}
                  initialLanguage={quote.language}
                  triggerLabel="تعديل (سينشئ نسخة جديدة تحتاج توقيعاً جديداً)"
                  triggerVariant="outline"
                  warnEditingSigned
                />
              )}
              {canSendQuote && quote.status !== "signed" && (
                <SendQuoteButton
                  jobId={jobId}
                  quoteId={quote.id}
                  customerPhone={customerPhone}
                  label={quote.status === "sent" ? "إعادة إرسال / عرض الرابط" : "إرسال للعميل"}
                />
              )}
              {canCloseDeal &&
                quote.signedVersionId &&
                quote.signedVersionId !== jobSourceQuoteVersionId && (
                  <ConvertToJobButton jobId={jobId} quoteId={quote.id} />
                )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
