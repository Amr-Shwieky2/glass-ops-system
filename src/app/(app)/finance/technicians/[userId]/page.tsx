import type { Metadata } from "next";
import { redirect, notFound } from "next/navigation";
import { Wallet } from "lucide-react";
import { getCurrentUser } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { PERMISSIONS } from "@/server/auth/permission-keys";
import { getUserBasicInfo } from "../../queries";
import {
  getTechnicianLedger,
  getBonusRules,
  getPenaltyRules,
} from "@/server/compensation/queries";
import { getSetting } from "@/server/settings";
import { formatILS, isNegative, isPositive } from "@/server/money";
import { Forbidden } from "@/components/forbidden";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { ReportPaymentDialog } from "../report-payment-dialog";
import { LedgerDecisionButtons } from "../ledger-decision-buttons";
import { VehicleDeductionDialog, BonusDialog, PenaltyDialog, DailyWageDialog } from "../quick-action-dialogs";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ userId: string }>;
}): Promise<Metadata> {
  const { userId } = await params;
  const target = await getUserBasicInfo(userId);
  return { title: `${target?.name ?? "حساب فني"} | نظام إدارة عمليات الزجاج` };
}

const ENTRY_TYPE_LABEL_AR: Record<string, string> = {
  installation_earning: "مستحق تركيب",
  daily_wage: "أجر يومي",
  bonus: "مكافأة",
  penalty: "غرامة",
  commission: "عمولة",
  fuel_reimbursement: "تعويض وقود",
  vehicle_usage_deduction: "خصم استخدام مركبة",
  payment_made: "دفعة مستلمة",
  other_adjustment: "تسوية أخرى",
};

const APPROVAL_STATUS_LABEL_AR: Record<string, string> = {
  pending: "بانتظار الاعتماد",
  approved: "معتمد",
  rejected: "مرفوض",
};

const APPROVAL_STATUS_VARIANT: Record<string, "warning" | "success" | "destructive"> = {
  pending: "warning",
  approved: "success",
  rejected: "destructive",
};

const dateFmt = new Intl.DateTimeFormat("ar", {
  year: "numeric",
  month: "short",
  day: "numeric",
  numberingSystem: "latn",
});

export default async function TechnicianLedgerPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const isOwnPage = user.id === userId;
  const canViewAnyBalance = can(user, PERMISSIONS.VIEW_TECHNICIAN_BALANCES);
  if (!isOwnPage && !canViewAnyBalance) {
    return <Forbidden message="يمكنك فقط الاطلاع على حسابك الخاص." />;
  }

  const targetUser = await getUserBasicInfo(userId);
  if (!targetUser) notFound();

  const canManage = can(user, PERMISSIONS.MANAGE_TECHNICIAN_PAYMENTS);
  const showManagerQuickActions = canManage && !isOwnPage;

  const [{ entries, balance }, bonusRules, penaltyRules, vehicleDefaultAmount] = await Promise.all([
    getTechnicianLedger(userId),
    showManagerQuickActions ? getBonusRules() : Promise.resolve([]),
    showManagerQuickActions ? getPenaltyRules() : Promise.resolve([]),
    showManagerQuickActions ? getSetting("vehicle_usage_deduction_default") : Promise.resolve(null),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{targetUser.name}</h1>
        <p className="text-sm text-muted-foreground">حساب الفني وسجل الحركات المالية</p>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4 p-6">
          <div className="flex items-center gap-3">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted">
              <Wallet className="size-6 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">الرصيد المستحق</p>
              <p
                dir="ltr"
                className={cn(
                  "text-2xl font-bold",
                  isNegative(balance) ? "text-destructive" : "text-foreground",
                )}
              >
                {formatILS(balance)}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {isOwnPage && <ReportPaymentDialog />}
            {showManagerQuickActions && (
              <>
                <VehicleDeductionDialog userId={userId} defaultAmount={vehicleDefaultAmount ?? "0.00"} />
                <BonusDialog userId={userId} bonusRules={bonusRules} />
                <PenaltyDialog userId={userId} penaltyRules={penaltyRules} />
                <DailyWageDialog userId={userId} />
              </>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">سجل الحركات</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {entries.length === 0 ? (
            <EmptyState title="لا توجد حركات مسجلة بعد" className="border-0 p-6" />
          ) : (
            <ul className="divide-y">
              {entries.map((e) => (
                <li key={e.id} className="space-y-2 px-4 py-3 sm:px-6">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span
                          dir="ltr"
                          className={cn(
                            "font-medium",
                            isNegative(e.amount)
                              ? "text-destructive"
                              : isPositive(e.amount)
                                ? "text-success"
                                : "text-foreground",
                          )}
                        >
                          {formatILS(e.amount)}
                        </span>
                        <span className="text-sm font-medium text-foreground">
                          {ENTRY_TYPE_LABEL_AR[e.entryType] ?? e.entryType}
                        </span>
                        <Badge variant={APPROVAL_STATUS_VARIANT[e.approvalStatus] ?? "outline"}>
                          {APPROVAL_STATUS_LABEL_AR[e.approvalStatus] ?? e.approvalStatus}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {dateFmt.format(e.createdAt)}
                        {e.relatedJobNumber ? ` · مهمة ${e.relatedJobNumber}` : ""}
                        {e.createdByUserName ? ` · بواسطة ${e.createdByUserName}` : ""}
                      </p>
                      {e.description && <p className="text-sm text-muted-foreground">{e.description}</p>}
                    </div>
                  </div>
                  {e.approvalStatus === "pending" && canManage && (
                    <LedgerDecisionButtons entryId={e.id} amount={e.amount} />
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
