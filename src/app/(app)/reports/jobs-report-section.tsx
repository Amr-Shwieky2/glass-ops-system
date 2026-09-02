import Link from "next/link";
import { Download, Briefcase } from "lucide-react";
import { getJobsReport } from "@/server/reports/queries";
import { getAllJobStatuses } from "@/server/jobs/queries";
import { formatILS } from "@/server/money";
import { jobStatusVariant } from "@/lib/job-status-style";
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
import { JobsStatusFilter } from "./jobs-status-filter";
import { DateRangeFields } from "./date-range-fields";

const dateFmt = new Intl.DateTimeFormat("ar", {
  year: "numeric",
  month: "short",
  day: "numeric",
  numberingSystem: "latn",
});

export async function JobsReportSection({
  statusKey,
  dateFrom,
  dateTo,
}: {
  statusKey?: string;
  dateFrom?: string;
  dateTo?: string;
}) {
  const [{ rows, counts }, statuses] = await Promise.all([
    getJobsReport({ statusKey, dateFrom, dateTo }),
    getAllJobStatuses(),
  ]);

  const exportParams = new URLSearchParams();
  if (statusKey) exportParams.set("statusKey", statusKey);
  if (dateFrom) exportParams.set("dateFrom", dateFrom);
  if (dateTo) exportParams.set("dateTo", dateTo);
  const exportQuery = exportParams.toString();

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">مفتوحة</p>
            <p className="text-2xl font-bold text-foreground">{counts.open}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">مكتملة</p>
            <p className="text-2xl font-bold text-foreground">{counts.completed}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">بحاجة لإصلاح</p>
            <p className="text-2xl font-bold text-foreground">{counts.repairNeeded}</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <form method="GET" className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="tab" value="jobs" />
          <JobsStatusFilter statuses={statuses} defaultValue={statusKey} />
          <DateRangeFields dateFrom={dateFrom} dateTo={dateTo} />
          <Button type="submit" variant="secondary">
            تصفية
          </Button>
        </form>
        <Button asChild variant="outline">
          <a
            href={`/api/reports/jobs${exportQuery ? `?${exportQuery}` : ""}`}
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
              icon={Briefcase}
              title="لا توجد مهام"
              description="لا توجد نتائج مطابقة لعوامل التصفية."
              className="border-0"
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>رقم المهمة</TableHead>
                  <TableHead>العميل</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>تاريخ الإنشاء</TableHead>
                  <TableHead>سعر البيع</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium text-foreground">
                      <Link href={`/jobs/${row.id}`} className="hover:underline">
                        {row.jobNumber}
                      </Link>
                    </TableCell>
                    <TableCell>{row.customerName}</TableCell>
                    <TableCell>
                      <Badge variant={jobStatusVariant(row.statusKey)}>
                        {row.statusLabelAr}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {dateFmt.format(row.createdAt)}
                    </TableCell>
                    <TableCell dir="ltr" className="text-end text-muted-foreground">
                      {row.salePriceTotal ? formatILS(row.salePriceTotal) : "—"}
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
