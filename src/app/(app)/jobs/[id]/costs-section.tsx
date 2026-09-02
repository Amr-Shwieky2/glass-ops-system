import { Wallet2 } from "lucide-react";
import type { JobCost } from "@/server/costs/queries";
import type { JobProfitability } from "@/server/costs/queries";
import { formatILS } from "@/server/money";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { AddCostDialog } from "./add-cost-dialog";
import { CostDecisionButtons } from "./cost-decision-buttons";

const dateFmt = new Intl.DateTimeFormat("ar", {
  year: "numeric",
  month: "short",
  day: "numeric",
  numberingSystem: "latn",
});

const CATEGORY_LABEL_AR: Record<JobCost["category"], string> = {
  factory_glass: "زجاج المصنع",
  hardware: "مواد وتجهيزات",
  installer_labor: "أجرة تركيب فني",
  daily_worker_labor: "أجرة عامل يومي",
  external_contractor: "مقاول خارجي",
  aluminum_contractor: "مقاول ألمنيوم",
  fuel: "وقود",
  other: "أخرى",
};

const STATUS_LABEL_AR: Record<JobCost["status"], string> = {
  pending: "بانتظار الاعتماد",
  approved: "معتمدة",
  rejected: "مرفوضة",
};

const STATUS_VARIANT: Record<
  JobCost["status"],
  "warning" | "success" | "destructive"
> = {
  pending: "warning",
  approved: "success",
  rejected: "destructive",
};

export function CostsSection({
  jobId,
  costsResult,
  profitability,
  canViewProfitability,
  canManageJobCosts,
  canApproveRequests,
  externalContractors,
}: {
  jobId: string;
  costsResult: { costs: JobCost[]; totalApproved: string };
  profitability: JobProfitability;
  canViewProfitability: boolean;
  canManageJobCosts: boolean;
  canApproveRequests: boolean;
  externalContractors: { id: string; name: string }[];
}) {
  const { costs, totalApproved } = costsResult;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <Wallet2 className="size-5 text-muted-foreground" />
          التكاليف
        </CardTitle>
        {canManageJobCosts && (
          <AddCostDialog jobId={jobId} externalContractors={externalContractors} />
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
          <div>
            <p className="text-muted-foreground">إجمالي التكلفة المعتمدة</p>
            <p dir="ltr" className="text-end text-xl font-bold text-foreground">
              {formatILS(totalApproved)}
            </p>
          </div>
        </div>

        {canViewProfitability && (
          <div className="grid grid-cols-2 gap-4 rounded-lg border bg-muted/30 p-4 text-sm sm:grid-cols-4">
            <div>
              <p className="text-muted-foreground">سعر البيع</p>
              <p dir="ltr" className="text-end font-medium text-foreground">
                {profitability.revenue ? formatILS(profitability.revenue) : "—"}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">التكلفة المعتمدة</p>
              <p dir="ltr" className="text-end font-medium text-foreground">
                {formatILS(profitability.confirmedCost)}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">الربح الإجمالي</p>
              <p dir="ltr" className="text-end font-medium text-foreground">
                {profitability.grossProfit ? formatILS(profitability.grossProfit) : "—"}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">هامش الربح</p>
              <p dir="ltr" className="text-end font-medium text-foreground">
                {profitability.marginPercent !== null
                  ? `${profitability.marginPercent.toFixed(1)}%`
                  : "—"}
              </p>
            </div>
          </div>
        )}

        {costs.length === 0 ? (
          <EmptyState title="لا توجد تكاليف مسجلة على هذه المهمة" className="border-0 p-6" />
        ) : (
          <ul className="divide-y">
            {costs.map((c) => (
              <li key={c.id} className="space-y-2 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-foreground">
                        {CATEGORY_LABEL_AR[c.category]}
                      </span>
                      <Badge variant={STATUS_VARIANT[c.status]}>
                        {STATUS_LABEL_AR[c.status]}
                      </Badge>
                    </div>
                    <p dir="ltr" className="text-end text-sm font-medium text-foreground">
                      {formatILS(c.amount)}
                    </p>
                    {c.description && (
                      <p className="text-sm text-muted-foreground">{c.description}</p>
                    )}
                    <p className="text-sm text-muted-foreground">
                      {c.vendorUserName ?? c.externalContractorName
                        ? `${c.vendorUserName ?? c.externalContractorName} · `
                        : ""}
                      {dateFmt.format(new Date(c.incurredAt))}
                    </p>
                  </div>
                </div>
                {c.status === "pending" && canApproveRequests && (
                  <CostDecisionButtons costId={c.id} amount={c.amount} />
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
