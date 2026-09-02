import Link from "next/link";
import { Download, Fuel } from "lucide-react";
import { getVehiclesFuelByMonthReport } from "@/server/reports/queries";
import { formatILS } from "@/server/money";
import { Card, CardContent } from "@/components/ui/card";
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

export async function VehiclesReportSection({ month }: { month?: string }) {
  const rows = await getVehiclesFuelByMonthReport({ month });

  const exportQuery = month ? `?${new URLSearchParams({ month }).toString()}` : "";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <form method="GET" className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="tab" value="vehicles" />
          <div className="space-y-1">
            <Label htmlFor="month" className="text-xs text-muted-foreground">
              الشهر
            </Label>
            <Input id="month" name="month" type="month" dir="ltr" defaultValue={month} />
          </div>
          <Button type="submit" variant="secondary">
            تصفية
          </Button>
        </form>
        <Button asChild variant="outline">
          <a
            href={`/api/reports/vehicles${exportQuery}`}
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
              icon={Fuel}
              title="لا توجد سجلات وقود"
              description="لا توجد سجلات وقود مطابقة."
              className="border-0"
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>المركبة</TableHead>
                  <TableHead>رقم اللوحة</TableHead>
                  <TableHead>الشهر</TableHead>
                  <TableHead>تكلفة الوقود</TableHead>
                  <TableHead>الليترات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={`${row.vehicleId}:${row.month}`}>
                    <TableCell className="font-medium text-foreground">
                      <Link href={`/vehicles/${row.vehicleId}`} className="hover:underline">
                        {row.vehicleName}
                      </Link>
                    </TableCell>
                    <TableCell dir="ltr" className="text-end text-muted-foreground">
                      {row.plateNumber}
                    </TableCell>
                    <TableCell dir="ltr" className="text-end text-muted-foreground">
                      {row.month}
                    </TableCell>
                    <TableCell dir="ltr" className="text-end text-muted-foreground">
                      {formatILS(row.totalFuelCost)}
                    </TableCell>
                    <TableCell dir="ltr" className="text-end text-muted-foreground">
                      {row.totalLiters ?? "—"}
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
