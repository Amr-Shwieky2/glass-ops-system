import Link from "next/link";
import { Download, Wallet } from "lucide-react";
import { getTechniciansEarningsReport } from "@/server/reports/queries";
import { formatILS } from "@/server/money";
import { Card, CardContent } from "@/components/ui/card";
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

export async function TechniciansReportSection({
  dateFrom,
  dateTo,
}: {
  dateFrom?: string;
  dateTo?: string;
}) {
  const rows = await getTechniciansEarningsReport({ dateFrom, dateTo });

  const exportParams = new URLSearchParams();
  if (dateFrom) exportParams.set("dateFrom", dateFrom);
  if (dateTo) exportParams.set("dateTo", dateTo);
  const exportQuery = exportParams.toString();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <form method="GET" className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="tab" value="technicians" />
          <DateRangeFields dateFrom={dateFrom} dateTo={dateTo} />
          <Button type="submit" variant="secondary">
            تصفية
          </Button>
        </form>
        <Button asChild variant="outline">
          <a
            href={`/api/reports/technicians${exportQuery ? `?${exportQuery}` : ""}`}
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
              icon={Wallet}
              title="لا يوجد فنيون"
              description="لا يوجد فنيون مسجلون حالياً."
              className="border-0"
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الفني</TableHead>
                  <TableHead>إجمالي المستحقات</TableHead>
                  <TableHead>إجمالي المدفوع</TableHead>
                  <TableHead>المتبقي</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.userId}>
                    <TableCell className="font-medium text-foreground">
                      <Link href={`/finance/technicians/${row.userId}`} className="hover:underline">
                        {row.userName}
                      </Link>
                    </TableCell>
                    <TableCell dir="ltr" className="text-end text-muted-foreground">
                      {formatILS(row.totalEarned)}
                    </TableCell>
                    <TableCell dir="ltr" className="text-end text-muted-foreground">
                      {formatILS(row.totalPaid)}
                    </TableCell>
                    <TableCell dir="ltr" className="text-end font-medium text-foreground">
                      {formatILS(row.remaining)}
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
