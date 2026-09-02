import type { Metadata } from "next";
import Link from "next/link";
import { Briefcase, Users, Wallet, Fuel, TrendingUp } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { getCurrentUser, type AuthedUser } from "@/server/auth/session";
import { can, canAny } from "@/server/auth/permissions";
import { PERMISSIONS } from "@/server/auth/permission-keys";
import { Forbidden } from "@/components/forbidden";
import { Button } from "@/components/ui/button";
import { JobsReportSection } from "./jobs-report-section";
import { CustomersReportSection } from "./customers-report-section";
import { TechniciansReportSection } from "./technicians-report-section";
import { VehiclesReportSection } from "./vehicles-report-section";
import { ProfitabilityReportSection } from "./profitability-report-section";

export const metadata: Metadata = { title: "التقارير | نظام إدارة عمليات الزجاج" };

/**
 * The five management reports (spec section 68). Each has its OWN required
 * permission — not the broader [VIEW_PROFITABILITY, VIEW_JOB_COSTS] gate
 * src/config/nav.ts uses just to decide whether "/reports" is a dead link —
 * matching exactly what src/app/api/reports/[report]/route.ts already
 * requires for that report's CSV export, so a tab is never shown (and its
 * data never fetched) for a viewer who couldn't also export it:
 *   - jobs / customers -> VIEW_ALL_JOBS
 *   - technicians       -> VIEW_TECHNICIAN_BALANCES
 *   - vehicles          -> MANAGE_VEHICLES or ADD_FUEL
 *   - profitability     -> VIEW_PROFITABILITY specifically (section 48 —
 *     VIEW_JOB_COSTS is NOT sufficient, this exposes revenue/margin too)
 */
const REPORT_TABS: { key: string; label: string; icon: LucideIcon }[] = [
  { key: "jobs", label: "المهام", icon: Briefcase },
  { key: "customers", label: "أرصدة العملاء", icon: Users },
  { key: "technicians", label: "مستحقات الفنيين", icon: Wallet },
  { key: "vehicles", label: "وقود المركبات", icon: Fuel },
  { key: "profitability", label: "الربحية", icon: TrendingUp },
];

function hasReportAccess(user: AuthedUser | null, key: string): boolean {
  switch (key) {
    case "jobs":
    case "customers":
      return can(user, PERMISSIONS.VIEW_ALL_JOBS);
    case "technicians":
      return can(user, PERMISSIONS.VIEW_TECHNICIAN_BALANCES);
    case "vehicles":
      return canAny(user, [PERMISSIONS.MANAGE_VEHICLES, PERMISSIONS.ADD_FUEL]);
    case "profitability":
      return can(user, PERMISSIONS.VIEW_PROFITABILITY);
    default:
      return false;
  }
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    statusKey?: string;
    dateFrom?: string;
    dateTo?: string;
    month?: string;
  }>;
}) {
  const params = await searchParams;
  const user = await getCurrentUser();

  const permittedTabs = REPORT_TABS.filter((t) => hasReportAccess(user, t.key));
  if (permittedTabs.length === 0) {
    return <Forbidden />;
  }

  const activeKey = permittedTabs.some((t) => t.key === params.tab)
    ? params.tab!
    : permittedTabs[0].key;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">التقارير</h1>
        <p className="text-sm text-muted-foreground">
          تقارير إدارية قابلة للتصفية والتصدير بصيغة CSV.
        </p>
      </div>

      <nav className="flex flex-wrap gap-2">
        {permittedTabs.map((t) => {
          const Icon = t.icon;
          const active = t.key === activeKey;
          return (
            <Button key={t.key} asChild variant={active ? "default" : "outline"} size="sm">
              <Link href={`/reports?tab=${t.key}`}>
                <Icon className="size-4" />
                {t.label}
              </Link>
            </Button>
          );
        })}
      </nav>

      {activeKey === "jobs" && (
        <JobsReportSection statusKey={params.statusKey} dateFrom={params.dateFrom} dateTo={params.dateTo} />
      )}
      {activeKey === "customers" && <CustomersReportSection />}
      {activeKey === "technicians" && (
        <TechniciansReportSection dateFrom={params.dateFrom} dateTo={params.dateTo} />
      )}
      {activeKey === "vehicles" && <VehiclesReportSection month={params.month} />}
      {activeKey === "profitability" && (
        <ProfitabilityReportSection dateFrom={params.dateFrom} dateTo={params.dateTo} />
      )}
    </div>
  );
}
