import Link from "next/link";
import { Download, TrendingUp } from "lucide-react";
import { getProfitabilityReport } from "@/server/reports/queries";
import { formatILS, isNegative } from "@/server/money";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import { DateRangeFields } from "./date-range-fields";

const dateFmt = new Intl.DateTimeFormat("ar", {
  year: "numeric",
  month: "short",
  day: "numeric",
  numberingSystem: "latn",
});

/**
 * SENSITIVE (section 48) — this section is only ever reached when the
 * viewer holds VIEW_PROFITABILITY specifically (see page.tsx's
 * hasReportAccess), matching the same gate the CSV export route enforces
 * for this report.
 */
export async function ProfitabilityReportSection({
  dateFrom,
  dateTo,
}: {
  dateFrom?: string;
  dateTo?: string;
}) {
  const rows = await getProfitabilityReport({ dateFrom, dateTo });

  const exportParams = new URLSearchParams();
  if (dateFrom) exportParams.set("dateFrom", dateFrom);
  if (dateTo) exportParams.set("dateTo", dateTo);
  const exportQuery = exportParams.toString();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <form method="GET" className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="tab" value="profitability" />
          <DateRangeFields dateFrom={dateFrom} dateTo={dateTo} />
          <Button type="submit" variant="secondary">
            تصفية
          </Button>
        </form>
        <Button asChild variant="outline">
          <a
            href={`/api/reports/profitability${exportQuery ? `?${exportQuery}` : ""}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Download className="size-4" />
            تصدير CSV
          </a>
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <EmptyState
              icon={TrendingUp}
              title="لا توجد بيانات ربحية"
              description="لا توجد مهام مسعّرة مطابقة لعوامل التصفية."
              className="border-0"
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>رقم المهمة</TableHead>
                  <TableHead>العميل</TableHead>
                  <TableHead>تاريخ الإنشاء</TableHead>
                  <TableHead>الإيراد</TableHead>
                  <TableHead>التكلفة المعتمدة</TableHead>
                  <TableHead>الربح الإجمالي</TableHead>
                  <TableHead>هامش الربح %</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.jobId}>
                    <TableCell className="font-medium text-foreground">
                      <Link href={`/jobs/${row.jobId}`} className="hover:underline">
                        {row.jobNumber}
                      </Link>
                    </TableCell>
                    <TableCell>{row.customerName}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {dateFmt.format(row.createdAt)}
                    </TableCell>
                    <TableCell dir="ltr" className="text-end text-muted-foreground">
                      {formatILS(row.revenue)}
                    </TableCell>
                    <TableCell dir="ltr" className="text-end text-muted-foreground">
                      {formatILS(row.confirmedCost)}
                    </TableCell>
                    <TableCell dir="ltr" className="text-end font-medium text-foreground">
                      {formatILS(row.grossProfit)}
                    </TableCell>
                    <TableCell dir="ltr" className="text-end">
                      {row.marginPercent === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <Badge variant={isNegative(row.grossProfit) ? "destructive" : "success"}>
                          {row.marginPercent.toFixed(1)}%
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
