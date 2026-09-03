import type { Metadata } from "next";
import { redirect, notFound } from "next/navigation";
import { Wallet, Banknote } from "lucide-react";
import { getCurrentUser } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { PERMISSIONS } from "@/server/auth/permission-keys";
import { getUserBasicInfo } from "../../queries";
import {
  getTechnicianLedger,
  getBonusRules,
  getPenaltyRules,
} from "@/server/compensation/queries";
import {
  getCashAccountBalanceForUser,
  getCashAccountIdForUser,
  getCashTransactionHistory,
} from "@/server/finance/queries";
import { getSetting } from "@/server/settings";
import { formatILS, isNegative, isPositive } from "@/server/money";
import { Forbidden } from "@/components/forbidden";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { ReportPaymentDialog } from "../report-payment-dialog";
import { LedgerDecisionButtons } from "../ledger-decision-buttons";
import { VehicleDeductionDialog, BonusDialog, PenaltyDialog, DailyWageDialog } from "../quick-action-dialogs";
import { DirectionFilterSelect } from "./direction-filter-select";

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

const dateTimeFmt = new Intl.DateTimeFormat("ar", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  numberingSystem: "latn",
});

/**
 * cash_transactions.sourceType -> plain Arabic label for the cash drawer
 * table below. Sourced from every `sourceType: "..."` literal actually
 * written across src/server/finance (see cash.ts, transfer-actions.ts,
 * payments/record.ts, approvals/decide.ts) plus 'adjustment' per the
 * schema comment on cashTransactions.
 */
const CASH_SOURCE_TYPE_LABEL_AR: Record<string, string> = {
  customer_payment: "تحصيل من عميل",
  transfer: "تحويل نقدي",
  adjustment: "تسوية",
};

const CASH_DIRECTIONS = new Set(["in", "out"]);

export default async function TechnicianLedgerPage({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{ dateFrom?: string; dateTo?: string; direction?: string }>;
}) {
  const { userId } = await params;
  const cashFilters = await searchParams;
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

  const cashDateFrom = cashFilters.dateFrom ? new Date(`${cashFilters.dateFrom}T00:00:00`) : undefined;
  const cashDateTo = cashFilters.dateTo ? new Date(`${cashFilters.dateTo}T23:59:59.999`) : undefined;
  const cashDirection =
    cashFilters.direction && CASH_DIRECTIONS.has(cashFilters.direction)
      ? (cashFilters.direction as "in" | "out")
      : undefined;

  const [{ entries, balance }, bonusRules, penaltyRules, vehicleDefaultAmount, cashBalance, cashAccountId] =
    await Promise.all([
      getTechnicianLedger(userId),
      showManagerQuickActions ? getBonusRules() : Promise.resolve([]),
      showManagerQuickActions ? getPenaltyRules() : Promise.resolve([]),
      showManagerQuickActions ? getSetting("vehicle_usage_deduction_default") : Promise.resolve(null),
      getCashAccountBalanceForUser(userId),
      getCashAccountIdForUser(userId),
    ]);

  const cashTransactions = cashAccountId
    ? await getCashTransactionHistory(cashAccountId, {
        dateFrom: cashDateFrom && !Number.isNaN(cashDateFrom.getTime()) ? cashDateFrom : undefined,
        dateTo: cashDateTo && !Number.isNaN(cashDateTo.getTime()) ? cashDateTo : undefined,
        direction: cashDirection,
      })
    : [];

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

      {/*
        صندوق النقد — cash the technician is currently physically holding
        (cash_accounts/cash_transactions, Phase 8), a genuinely different
        thing from the compensation ledger above (money the company owes
        the technician). Gated by the same page-level check above (either
        it's the viewer's own page, or they hold VIEW_TECHNICIAN_BALANCES)
        — no separate/looser/tighter gate here.
      */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Banknote className="size-5 text-muted-foreground" />
            صندوق النقد
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted">
              <Banknote className="size-6 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">رصيد الصندوق الحالي</p>
              <p dir="ltr" className="text-2xl font-bold text-foreground">
                {formatILS(cashBalance)}
              </p>
            </div>
          </div>

          <form method="GET" className="flex flex-wrap items-end gap-2">
            <DirectionFilterSelect defaultValue={cashFilters.direction} />
            <div className="space-y-1">
              <Label htmlFor="dateFrom" className="text-xs text-muted-foreground">
                من تاريخ
              </Label>
              <Input
                id="dateFrom"
                name="dateFrom"
                type="date"
                dir="ltr"
                defaultValue={cashFilters.dateFrom}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="dateTo" className="text-xs text-muted-foreground">
                إلى تاريخ
              </Label>
              <Input
                id="dateTo"
                name="dateTo"
                type="date"
                dir="ltr"
                defaultValue={cashFilters.dateTo}
              />
            </div>
            {cashFilters.direction && (
              <input type="hidden" name="direction" value={cashFilters.direction} />
            )}
            <Button type="submit" variant="secondary">
              تصفية
            </Button>
          </form>

          {cashTransactions.length === 0 ? (
            <EmptyState
              title="لا توجد حركات نقدية"
              description={
                cashFilters.dateFrom || cashFilters.dateTo || cashFilters.direction
                  ? "لا توجد نتائج مطابقة لعوامل التصفية."
                  : "لم تُسجَّل أي حركة في هذا الصندوق بعد."
              }
              className="border-0 p-6"
            />
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>التاريخ والوقت</TableHead>
                    <TableHead>الحركة</TableHead>
                    <TableHead>المبلغ</TableHead>
                    <TableHead>المصدر</TableHead>
                    <TableHead>ملاحظات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cashTransactions.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="text-muted-foreground">
                        {dateTimeFmt.format(t.createdAt)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={t.direction === "in" ? "success" : "destructive"}>
                          {t.direction === "in" ? "دخول" : "خروج"}
                        </Badge>
                      </TableCell>
                      <TableCell
                        dir="ltr"
                        className={cn(
                          "font-medium",
                          t.direction === "in" ? "text-success" : "text-destructive",
                        )}
                      >
                        {formatILS(t.amount)}
                      </TableCell>
                      <TableCell>
                        {CASH_SOURCE_TYPE_LABEL_AR[t.sourceType] ?? t.sourceType}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{t.notes ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
