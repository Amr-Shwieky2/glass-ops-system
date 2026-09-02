import { HandCoins } from "lucide-react";
import type { LedgerEntry, CompensationRuleOption, BonusRuleOption, PenaltyRuleOption } from "@/server/compensation/queries";
import type { CommissionForJob } from "@/server/compensation/commission";
import { formatILS } from "@/server/money";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { AllocateEarningDialog } from "./allocate-earning-dialog";
import { BonusDialog, PenaltyDialog } from "./bonus-penalty-dialogs";
import { EstimateCommissionButton, FinalizeCommissionButton } from "./commission-actions";

const dateFmt = new Intl.DateTimeFormat("ar", {
  year: "numeric",
  month: "short",
  day: "numeric",
  numberingSystem: "latn",
});

const ENTRY_TYPE_LABEL_AR: Record<string, string> = {
  installation_earning: "مستحق تركيب",
  daily_wage: "أجر يومي",
  bonus: "مكافأة",
  penalty: "غرامة",
  commission: "عمولة",
  fuel_reimbursement: "تعويض وقود",
  vehicle_usage_deduction: "خصم استخدام مركبة",
  payment_made: "دفعة مستلمة",
  other_adjustment: "تعديل آخر",
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

const COMMISSION_STATUS_LABEL_AR: Record<CommissionForJob["status"], string> = {
  estimated: "مقدَّرة",
  finalized: "نهائية معتمدة",
};

const COMMISSION_STATUS_VARIANT: Record<
  CommissionForJob["status"],
  "warning" | "success"
> = {
  estimated: "warning",
  finalized: "success",
};

export function CompensationSection({
  jobId,
  entries,
  technicianNameByEntryId,
  commission,
  assignableUsers,
  compensationRules,
  bonusRules,
  penaltyRules,
  jobItems,
  canManageTechnicianPayments,
  canViewTechnicianLedger,
}: {
  jobId: string;
  entries: LedgerEntry[];
  technicianNameByEntryId: Record<string, string>;
  commission: CommissionForJob | null;
  assignableUsers: { id: string; name: string }[];
  compensationRules: CompensationRuleOption[];
  bonusRules: BonusRuleOption[];
  penaltyRules: PenaltyRuleOption[];
  jobItems: { id: string; description: string | null; workTypeLabelAr: string | null }[];
  canManageTechnicianPayments: boolean;
  /**
   * Gates the per-technician ledger entry list below (names, penalty/bonus
   * reasons, per-entry amounts) — requires VIEW_TECHNICIAN_BALANCES (or
   * MANAGE_TECHNICIAN_PAYMENTS), the same permission /finance/technicians
   * requires for this exact kind of data. Deliberately narrower than
   * whatever gate got this component rendered at all (VIEW_PROFITABILITY
   * alone is enough for that, to still show the commission summary card
   * below — aggregate financial data, not per-technician identity — but
   * must NOT be enough on its own to reveal the entry list.
   */
  canViewTechnicianLedger: boolean;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <HandCoins className="size-5 text-muted-foreground" />
          تعويض الفنيين
        </CardTitle>
        {canManageTechnicianPayments && (
          <div className="flex flex-wrap items-center gap-2">
            <BonusDialog jobId={jobId} assignableUsers={assignableUsers} bonusRules={bonusRules} />
            <PenaltyDialog jobId={jobId} assignableUsers={assignableUsers} penaltyRules={penaltyRules} />
            <AllocateEarningDialog
              jobId={jobId}
              assignableUsers={assignableUsers}
              compensationRules={compensationRules}
              jobItems={jobItems}
            />
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border bg-muted/30 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <p className="font-medium text-foreground">العمولة</p>
                {commission && (
                  <Badge variant={COMMISSION_STATUS_VARIANT[commission.status]}>
                    {COMMISSION_STATUS_LABEL_AR[commission.status]}
                  </Badge>
                )}
              </div>
              {commission ? (
                <div className="mt-1 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
                  <p className="text-muted-foreground">
                    الربح الإجمالي:{" "}
                    <span dir="ltr" className="font-medium text-foreground">
                      {formatILS(
                        (commission.status === "finalized"
                          ? commission.finalGrossProfit
                          : commission.estimatedGrossProfit) ?? "0.00",
                      )}
                    </span>
                  </p>
                  <p className="text-muted-foreground">
                    مبلغ العمولة:{" "}
                    <span dir="ltr" className="font-medium text-foreground">
                      {formatILS(
                        (commission.status === "finalized"
                          ? commission.finalAmount
                          : commission.estimatedAmount) ?? "0.00",
                      )}
                    </span>
                  </p>
                  <p className="text-muted-foreground">
                    النسبة: <span dir="ltr">{commission.ratePercent}%</span>
                  </p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">لم يتم احتساب عمولة لهذه المهمة بعد.</p>
              )}
            </div>
            {canManageTechnicianPayments && (
              <div className="flex flex-wrap items-center gap-2">
                <EstimateCommissionButton jobId={jobId} />
                <FinalizeCommissionButton
                  jobId={jobId}
                  isFinalized={commission?.status === "finalized"}
                />
              </div>
            )}
          </div>
        </div>

        {canViewTechnicianLedger &&
          (entries.length === 0 ? (
            <EmptyState title="لا توجد قيود تعويض على هذه المهمة" className="border-0 p-6" />
          ) : (
            <ul className="divide-y">
              {entries.map((e) => (
                <li key={e.id} className="py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-foreground">
                          {technicianNameByEntryId[e.id] ?? "فني غير معروف"}
                        </span>
                        <span className="text-sm text-muted-foreground">
                          {ENTRY_TYPE_LABEL_AR[e.entryType] ?? e.entryType}
                        </span>
                        <Badge variant={APPROVAL_STATUS_VARIANT[e.approvalStatus] ?? "outline"}>
                          {APPROVAL_STATUS_LABEL_AR[e.approvalStatus] ?? e.approvalStatus}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {e.createdByUserName ? `بواسطة ${e.createdByUserName} · ` : ""}
                        {dateFmt.format(e.createdAt)}
                      </p>
                      {e.description && (
                        <p className="text-sm text-muted-foreground">{e.description}</p>
                      )}
                    </div>
                    <span dir="ltr" className="font-medium text-foreground">
                      {formatILS(e.amount)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          ))}
      </CardContent>
    </Card>
  );
}
