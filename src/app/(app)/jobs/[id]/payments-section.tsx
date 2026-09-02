import { Wallet } from "lucide-react";
import type { JobPaymentsResult } from "@/server/payments/queries";
import { formatILS } from "@/server/money";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { AddPaymentDialog } from "./add-payment-dialog";
import { PaymentDecisionButtons } from "./payment-decision-buttons";

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
  canCollectPayment,
  canApprovePayment,
}: {
  jobId: string;
  hasSalePrice: boolean;
  paymentsResult: JobPaymentsResult;
  canCollectPayment: boolean;
  canApprovePayment: boolean;
}) {
  const { payments, totalApproved, remaining } = paymentsResult;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <Wallet className="size-5 text-muted-foreground" />
          المدفوعات
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
            <div>
              <p className="text-muted-foreground">المحصَّل</p>
              <p dir="ltr" className="text-end text-xl font-bold text-foreground">
                {formatILS(totalApproved)}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">المتبقي</p>
              <p dir="ltr" className="text-end text-xl font-bold text-foreground">
                {remaining ? formatILS(remaining) : "—"}
              </p>
            </div>
          </div>
        )}

        {payments.length === 0 ? (
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
                {p.approvalStatus === "pending" && canApprovePayment && (
                  <PaymentDecisionButtons paymentId={p.id} amount={p.amount} />
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
