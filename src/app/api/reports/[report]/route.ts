import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { canAny } from "@/server/auth/permissions";
import { PERMISSIONS } from "@/server/auth/permission-keys";
import {
  getJobsReport,
  getCustomersOutstandingBalanceReport,
  getTechniciansEarningsReport,
  getVehiclesFuelByMonthReport,
  getProfitabilityReport,
} from "@/server/reports/queries";
import { buildCsv, csvResponseHeaders } from "@/server/reports/csv";

const REPORT_KEYS = ["jobs", "customers", "technicians", "vehicles", "profitability"] as const;
type ReportKey = (typeof REPORT_KEYS)[number];

function isReportKey(value: string): value is ReportKey {
  return (REPORT_KEYS as readonly string[]).includes(value);
}

/** Plain ISO date (no time-of-day) — reports show/filter by day, not instant. */
function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * CSV export for the five management reports (spec section 68). A single
 * dynamic [report] segment rather than five route files since every
 * report shares the exact same shape: auth -> permission gate -> parse
 * filters from the query string -> query -> CSV -> download headers.
 *
 * Each report is gated behind whichever existing permission already
 * covers that data elsewhere in the app (no dedicated "view reports" key
 * exists in the catalogue, and none of these five genuinely need one):
 *   - jobs / customers -> VIEW_ALL_JOBS (same gate as the Jobs list/dashboard
 *     "all jobs" view; neither report is in the extra-sensitive categories
 *     section 48 calls out, so the ordinary jobs-visibility permission fits)
 *   - technicians       -> VIEW_TECHNICIAN_BALANCES (exactly what it's for)
 *   - vehicles          -> MANAGE_VEHICLES or ADD_FUEL (either implies
 *     legitimate reason to see vehicle/fuel cost data — mirrors the
 *     vehicle screens' own gating)
 *   - profitability     -> VIEW_PROFITABILITY specifically (section 48:
 *     revenue/cost/margin is the most sensitive category in the catalogue —
 *     VIEW_JOB_COSTS is NOT sufficient here, see getProfitabilityReport's
 *     own doc comment)
 *
 * A Route Handler is outside proxy.ts's matcher (see proxy.ts's own
 * comment, and src/app/api/quotes/[quoteId]/pdf/route.ts for the same
 * posture), so this permission check is the only thing standing between
 * an authenticated user and a report they're not supposed to see.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ report: string }> },
) {
  const { report } = await params;
  if (!isReportKey(report)) {
    return NextResponse.json({ error: "تقرير غير معروف." }, { status: 404 });
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "يجب تسجيل الدخول." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);

  switch (report) {
    case "jobs": {
      if (!canAny(user, [PERMISSIONS.VIEW_ALL_JOBS])) {
        return NextResponse.json({ error: "لا تملك صلاحية الوصول." }, { status: 403 });
      }
      const { rows } = await getJobsReport({
        statusKey: searchParams.get("statusKey") ?? undefined,
        dateFrom: searchParams.get("dateFrom") ?? undefined,
        dateTo: searchParams.get("dateTo") ?? undefined,
      });
      const csv = buildCsv(
        ["رقم المهمة", "العميل", "الحالة", "تاريخ الإنشاء", "سعر البيع"],
        rows.map((r) => [
          r.jobNumber,
          r.customerName,
          r.statusLabelAr,
          toDateString(r.createdAt),
          r.salePriceTotal,
        ]),
      );
      return new NextResponse(csv, { headers: csvResponseHeaders("jobs-report.csv") });
    }

    case "customers": {
      if (!canAny(user, [PERMISSIONS.VIEW_ALL_JOBS])) {
        return NextResponse.json({ error: "لا تملك صلاحية الوصول." }, { status: 403 });
      }
      const rows = await getCustomersOutstandingBalanceReport();
      const csv = buildCsv(
        ["العميل", "الهاتف", "الرصيد المستحق", "آخر مهمة", "تاريخ آخر مهمة"],
        rows.map((r) => [
          r.customerName,
          r.customerPhone,
          r.outstandingBalance,
          r.mostRecentJobNumber,
          toDateString(r.mostRecentJobDate),
        ]),
      );
      return new NextResponse(csv, {
        headers: csvResponseHeaders("customers-outstanding-report.csv"),
      });
    }

    case "technicians": {
      if (!canAny(user, [PERMISSIONS.VIEW_TECHNICIAN_BALANCES])) {
        return NextResponse.json({ error: "لا تملك صلاحية الوصول." }, { status: 403 });
      }
      const rows = await getTechniciansEarningsReport({
        dateFrom: searchParams.get("dateFrom") ?? undefined,
        dateTo: searchParams.get("dateTo") ?? undefined,
      });
      const csv = buildCsv(
        ["الفني", "إجمالي المستحقات", "إجمالي المدفوع", "المتبقي"],
        rows.map((r) => [r.userName, r.totalEarned, r.totalPaid, r.remaining]),
      );
      return new NextResponse(csv, {
        headers: csvResponseHeaders("technicians-earnings-report.csv"),
      });
    }

    case "vehicles": {
      if (!canAny(user, [PERMISSIONS.MANAGE_VEHICLES, PERMISSIONS.ADD_FUEL])) {
        return NextResponse.json({ error: "لا تملك صلاحية الوصول." }, { status: 403 });
      }
      const rows = await getVehiclesFuelByMonthReport({
        month: searchParams.get("month") ?? undefined,
      });
      const csv = buildCsv(
        ["المركبة", "رقم اللوحة", "الشهر", "تكلفة الوقود", "الليترات"],
        rows.map((r) => [
          r.vehicleName,
          r.plateNumber,
          r.month,
          r.totalFuelCost,
          r.totalLiters,
        ]),
      );
      return new NextResponse(csv, {
        headers: csvResponseHeaders("vehicles-fuel-report.csv"),
      });
    }

    case "profitability": {
      // SENSITIVE (section 48) — VIEW_PROFITABILITY specifically, not
      // VIEW_JOB_COSTS: this report exposes revenue and margin, not just
      // confirmed cost. See getProfitabilityReport's own doc comment.
      if (!canAny(user, [PERMISSIONS.VIEW_PROFITABILITY])) {
        return NextResponse.json({ error: "لا تملك صلاحية الوصول." }, { status: 403 });
      }
      const rows = await getProfitabilityReport({
        dateFrom: searchParams.get("dateFrom") ?? undefined,
        dateTo: searchParams.get("dateTo") ?? undefined,
      });
      const csv = buildCsv(
        [
          "رقم المهمة",
          "العميل",
          "تاريخ الإنشاء",
          "الإيراد",
          "التكلفة المعتمدة",
          "الربح الإجمالي",
          "هامش الربح %",
        ],
        rows.map((r) => [
          r.jobNumber,
          r.customerName,
          toDateString(r.createdAt),
          r.revenue,
          r.confirmedCost,
          r.grossProfit,
          r.marginPercent === null ? "" : r.marginPercent.toFixed(1),
        ]),
      );
      return new NextResponse(csv, {
        headers: csvResponseHeaders("profitability-report.csv"),
      });
    }
  }
}

