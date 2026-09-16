import { Wallet } from "lucide-react";
import type { JobPaymentsResult } from "@/server/payments/queries";
import { formatILS } from "@/server/money";
import {
  PAYMENT_STATUS_LABEL_AR,
  type PaymentStatus,
} from "@/server/jobs/payment-status";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { AddPaymentDialog } from "./add-payment-dialog";
import { PaymentDecisionButtons } from "./payment-decision-buttons";

const PAYMENT_STATUS_BADGE_VARIANT: Record<PaymentStatus, "outline" | "warning" | "success"> = {
  not_paid: "outline",
  partially_paid: "warning",
  fully_paid: "success",
};

const dateFmt = new Intl.DateTimeFormat("ar", {
  year: "numeric",
  month: "short",
  day: "numeric",
  numberingSystem: "latn",
});

const PAYMENT_METHOD_LABEL_AR: Record<string, string> = {
  cash: "نقدية",
  bank_transfer: "تحويل بنكي",
  check: "شيك",
  other: "أخرى",
};

const APPROVAL_STATUS_LABEL_AR: Record<string, string> = {
  pending: "بانتظار الاعتماد",
  approved: "معتمد",
  rejected: "مرفوض",
};

const APPROVAL_STATUS_VARIANT: Record<
  string,
  "warning" | "success" | "destructive"
> = {
  pending: "warning",
  approved: "success",
  rejected: "destructive",
};

export function PaymentsSection({
  jobId,
  hasSalePrice,
  paymentsResult,
  paymentStatus,
  canCollectPayment,
  canApprovePayment,
  canViewSalePrice,
  currentUserId,
  isSuperAdminUser,
}: {
  jobId: string;
  hasSalePrice: boolean;
  paymentsResult: JobPaymentsResult;
  paymentStatus: PaymentStatus | null;
  canCollectPayment: boolean;
  canApprovePayment: boolean;
  /** A COLLECT_PAYMENT-only holder (e.g. an installer) has a genuine
   * operational need to see the remaining balance — it's how much to
   * collect on site — but showing that ALONGSIDE the total already
   * collected lets them trivially back out the exact sale price by
   * addition, defeating VIEW_SALE_PRICE's entire purpose. So "المتبقي"
   * stays visible to any canCollectPayment holder, while "المحصَّل" and
   * the itemized payment list (whose amounts sum to the same figure) are
   * gated behind canViewSalePrice — or canApprovePayment, since deciding
   * a pending payment inherently requires seeing its amount. */
  canViewSalePrice: boolean;
  currentUserId: string;
  isSuperAdminUser: boolean;
}) {
  const { payments, totalApproved, remaining } = paymentsResult;
  const canViewPaymentAmounts = canViewSalePrice || canApprovePayment;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <Wallet className="size-5 text-muted-foreground" />
          المدفوعات
          {paymentStatus && (
            <Badge variant={PAYMENT_STATUS_BADGE_VARIANT[paymentStatus]}>
              {PAYMENT_STATUS_LABEL_AR[paymentStatus]}
            </Badge>
          )}
        </CardTitle>
        {canCollectPayment && <AddPaymentDialog jobId={jobId} />}
      </CardHeader>
      <CardContent className="space-y-4">
        {!hasSalePrice ? (
          <EmptyState
            title="لم يتم تحديد سعر البيع الإجمالي بعد"
            description="سيظهر ملخص المدفوعات بعد تحديد سعر المهمة."
            className="border-0 p-6"
          />
        ) : (
          <div className="grid grid-cols-2 gap-4 text-sm">
            {canViewPaymentAmounts && (
              <div>
                <p className="text-muted-foreground">المحصَّل</p>
                <p dir="ltr" className="text-end text-xl font-bold text-foreground">
                  {formatILS(totalApproved)}
                </p>
              </div>
            )}
            <div>
              <p className="text-muted-foreground">المتبقي</p>
              <p dir="ltr" className="text-end text-xl font-bold text-foreground">
                {remaining ? formatILS(remaining) : "—"}
              </p>
            </div>
          </div>
        )}

        {canViewPaymentAmounts &&
          (payments.length === 0 ? (
            <EmptyState title="لم يتم تسجيل أي دفعة بعد" className="border-0 p-6" />
          ) : (
            <ul className="divide-y">
              {payments.map((p) => (
                <li key={p.id} className="space-y-2 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span dir="ltr" className="font-medium text-foreground">
                          {formatILS(p.amount)}
                        </span>
                        <Badge variant={APPROVAL_STATUS_VARIANT[p.approvalStatus] ?? "outline"}>
                          {APPROVAL_STATUS_LABEL_AR[p.approvalStatus] ?? p.approvalStatus}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {PAYMENT_METHOD_LABEL_AR[p.method] ?? p.method} · بواسطة{" "}
                        {p.receivedByUserName} · {dateFmt.format(new Date(p.paymentDate))}
                      </p>
                      {p.notes && <p className="text-sm text-muted-foreground">{p.notes}</p>}
                    </div>
                  </div>
                  {p.approvalStatus === "pending" &&
                    canApprovePayment &&
                    (isSuperAdminUser || p.createdByUserId !== currentUserId) && (
                    <PaymentDecisionButtons paymentId={p.id} amount={p.amount} />
                  )}
                </li>
              ))}
            </ul>
          ))}
      </CardContent>
    </Card>
  );
}
