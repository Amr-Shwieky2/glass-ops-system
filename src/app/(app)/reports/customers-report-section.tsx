import Link from "next/link";
import { Download, Users } from "lucide-react";
import { getCustomersOutstandingBalanceReport } from "@/server/reports/queries";
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

const dateFmt = new Intl.DateTimeFormat("ar", {
  year: "numeric",
  month: "short",
  day: "numeric",
  numberingSystem: "latn",
});

/** No filters — getCustomersOutstandingBalanceReport is system-wide by
 * design (see its own doc comment in src/server/reports/queries.ts). */
export async function CustomersReportSection() {
  const rows = await getCustomersOutstandingBalanceReport();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {rows.length} {rows.length === 1 ? "عميل" : "عملاء"} برصيد مستحق
        </p>
        <Button asChild variant="outline">
          <a href="/api/reports/customers" target="_blank" rel="noopener noreferrer">
            <Download className="size-4" />
            تصدير CSV
          </a>
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <EmptyState
              icon={Users}
              title="لا يوجد رصيد مستحق"
              description="لا يوجد عملاء لديهم رصيد مستحق حالياً."
              className="border-0"
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>العميل</TableHead>
                  <TableHead>الهاتف</TableHead>
                  <TableHead>الرصيد المستحق</TableHead>
                  <TableHead>آخر مهمة</TableHead>
                  <TableHead>تاريخ آخر مهمة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.customerId}>
                    <TableCell className="font-medium text-foreground">
                      <Link href={`/customers/${row.customerId}`} className="hover:underline">
                        {row.customerName}
                      </Link>
                    </TableCell>
                    <TableCell dir="ltr" className="text-end text-muted-foreground">
                      {row.customerPhone}
                    </TableCell>
                    <TableCell dir="ltr" className="text-end font-medium text-foreground">
                      {formatILS(row.outstandingBalance)}
                    </TableCell>
                    <TableCell>
                      <Link href={`/jobs/${row.mostRecentJobId}`} className="hover:underline">
                        {row.mostRecentJobNumber}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {dateFmt.format(row.mostRecentJobDate)}
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
