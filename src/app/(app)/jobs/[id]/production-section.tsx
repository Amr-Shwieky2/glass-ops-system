import { Factory, CheckCircle2, XCircle } from "lucide-react";
import { formatILS } from "@/server/money";
import { unitLabelAr } from "@/lib/units";
import type { ProductionRequestForJob } from "@/server/production/queries";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PRODUCTION_STATUS_LABEL, productionStatusVariant } from "@/lib/production-status-style";
import { SendToFactoryDialog } from "./send-to-factory-dialog";
import { ShowFactoryLinkButton } from "./show-factory-link-button";
import { FactoryDecisionButtons } from "./factory-decision-buttons";
import { FactoryLinkManageButtons } from "./factory-link-manage-buttons";

const dateFmt = new Intl.DateTimeFormat("ar", {
  year: "numeric",
  month: "short",
  day: "numeric",
  numberingSystem: "latn",
});

const SUBMISSION_STATUS_LABEL: Record<string, string> = {
  pending: "بانتظار المراجعة",
  approved: "معتمد",
  rejected: "مرفوض",
};

interface JobItemForFactorySummary {
  description: string | null;
  quantity: string;
  unit: string | null;
  workTypeLabelAr?: string | null;
}

/** Best-effort starting text for a brand-new production request, listing
 * the job's priced items as a plain-text summary the sender can freely
 * edit — mirrors quote-section.tsx's deriveQuoteItemsFromJobItems, but a
 * production request is one free-text field, not structured line items. */
function summarizeJobItemsForFactory(items: JobItemForFactorySummary[]): string | undefined {
  if (items.length === 0) return undefined;
  return items
    .map(
      (item) =>
        `- ${item.workTypeLabelAr || item.description || "بند عمل"} (${item.quantity} ${unitLabelAr(item.unit)})`,
    )
    .join("\n");
}

export function ProductionSection({
  jobId,
  request,
  jobItems,
  canCreateProductionOrder,
  canApproveFactoryPrice,
  canViewJobCosts,
}: {
  jobId: string;
  request: ProductionRequestForJob | null;
  jobItems: JobItemForFactorySummary[];
  canCreateProductionOrder: boolean;
  canApproveFactoryPrice: boolean;
  /** Sprint 1 (security hardening): the factory-submitted price is a job
   * cost like any other and must be gated the same way — it was
   * previously rendered unconditionally to any job viewer, including an
   * assigned installer with no financial permission at all. Whoever can
   * decide the price (canApproveFactoryPrice) obviously needs to see it
   * too, regardless of VIEW_JOB_COSTS. */
  canViewJobCosts: boolean;
}) {
  const latest = request?.latestSubmission ?? null;
  const canViewFactoryPrice = canViewJobCosts || canApproveFactoryPrice;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <Factory className="size-5 text-muted-foreground" />
          الإنتاج والمصنع
          {request && (
            <>
              <span dir="ltr" className="text-sm font-normal text-muted-foreground">
                {request.requestNumber}
              </span>
              <Badge variant={productionStatusVariant(request.status)}>
                {PRODUCTION_STATUS_LABEL[request.status] ?? request.status}
              </Badge>
            </>
          )}
        </CardTitle>
        {canCreateProductionOrder && (
          <SendToFactoryDialog
            jobId={jobId}
            defaultDetails={summarizeJobItemsForFactory(jobItems)}
            hasRequest={request !== null}
          />
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {!request ? (
          <EmptyState
            title="لم يُرسل هذا العمل إلى المصنع بعد"
            description="أرسل تفاصيل الزجاج المطلوب إلى المصنع للحصول على سعر."
            className="border-0 p-6"
          />
        ) : (
          <>
            <div className="space-y-1 text-sm">
              <p className="whitespace-pre-line text-foreground">{request.details}</p>
              <p className="text-muted-foreground">
                بواسطة {request.requestedByName ?? "—"} · {dateFmt.format(request.createdAt)}
                {request.estimatedReadyDate &&
                  ` · جاهزية متوقعة (تقديرنا) ${dateFmt.format(new Date(request.estimatedReadyDate))}`}
              </p>
            </div>

            {(request.activeLink || canCreateProductionOrder) &&
              (canCreateProductionOrder || canApproveFactoryPrice) && (
              <div className="flex flex-wrap items-center gap-2">
                {request.activeLink && <ShowFactoryLinkButton token={request.activeLink.token} />}
                {canCreateProductionOrder && (
                  <FactoryLinkManageButtons
                    jobId={jobId}
                    linkId={request.activeLink?.id ?? null}
                    productionRequestId={request.id}
                  />
                )}
              </div>
            )}

            {latest && (
              <div className="space-y-2 rounded-lg border p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-foreground">آخر عرض من المصنع</span>
                  {canViewFactoryPrice && (
                    <span dir="ltr" className="font-bold text-foreground">
                      {formatILS(latest.submittedPrice)}
                    </span>
                  )}
                </div>
                {latest.notes && <p className="text-muted-foreground">{latest.notes}</p>}
                <p className="text-xs text-muted-foreground">
                  أُرسل بتاريخ {dateFmt.format(latest.submittedAt)}
                  {latest.estimatedReadyDate &&
                    ` · جاهزية متوقعة من المصنع ${dateFmt.format(new Date(latest.estimatedReadyDate))}`}
                </p>

                {latest.approvalStatus === "pending" && canApproveFactoryPrice && (
                  <FactoryDecisionButtons
                    jobId={jobId}
                    submissionId={latest.id}
                    submittedPrice={latest.submittedPrice}
                  />
                )}
                {latest.approvalStatus === "approved" && (
                  <div className="flex items-center gap-2 text-green-700">
                    <CheckCircle2 className="size-4 shrink-0" />
                    تم اعتماد هذا السعر وتسجيله كتكلفة على المهمة
                    {latest.approvedByName && ` بواسطة ${latest.approvedByName}`}.
                  </div>
                )}
                {latest.approvalStatus === "rejected" && (
                  <div className="space-y-1 text-destructive">
                    <div className="flex items-center gap-2">
                      <XCircle className="size-4 shrink-0" />
                      تم رفض هذا العرض{latest.approvedByName && ` بواسطة ${latest.approvedByName}`}.
                    </div>
                    {latest.rejectionReason && (
                      <p className="text-xs">السبب: {latest.rejectionReason}</p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      يمكن للمصنع إرسال سعر جديد عبر نفس الرابط.
                    </p>
                  </div>
                )}
              </div>
            )}

            {request.submissions.length > 1 && canViewFactoryPrice && (
              <div className="text-xs text-muted-foreground">
                محاولات سابقة:{" "}
                {request.submissions
                  .slice(1)
                  .map(
                    (s) =>
                      `${formatILS(s.submittedPrice)} (${SUBMISSION_STATUS_LABEL[s.approvalStatus] ?? s.approvalStatus})`,
                  )
                  .join("، ")}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
