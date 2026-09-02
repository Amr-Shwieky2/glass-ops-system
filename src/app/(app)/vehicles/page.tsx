import type { Metadata } from "next";
import Link from "next/link";
import { Truck } from "lucide-react";
import { getCurrentUser } from "@/server/auth/session";
import { can, canAny } from "@/server/auth/permissions";
import { PERMISSIONS } from "@/server/auth/permission-keys";
import { getVehiclesList } from "@/server/vehicles/queries";
import { formatILS } from "@/server/money";
import { Forbidden } from "@/components/forbidden";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { FUEL_TYPE_LABEL_AR } from "./fuel-type";
import { AddVehicleDialog } from "./add-vehicle-dialog";

export const metadata: Metadata = { title: "المركبات والوقود | نظام إدارة عمليات الزجاج" };

export default async function VehiclesPage() {
  const user = await getCurrentUser();
  // Matches nav.ts's gate: MANAGE_VEHICLES or ADD_FUEL alone is enough to
  // see the list — a technician who only holds ADD_FUEL still needs to
  // find a vehicle to log fuel against. The "Add Vehicle" trigger and
  // per-vehicle edit/assign-responsibility controls stay MANAGE_VEHICLES-only,
  // gated inside the detail page.
  if (!canAny(user, [PERMISSIONS.MANAGE_VEHICLES, PERMISSIONS.ADD_FUEL])) {
    return <Forbidden />;
  }

  const vehicles = await getVehiclesList();
  const canManage = can(user, PERMISSIONS.MANAGE_VEHICLES);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">المركبات والوقود</h1>
          <p className="text-sm text-muted-foreground">
            {vehicles.length} {vehicles.length === 1 ? "مركبة" : "مركبات"}
          </p>
        </div>
        {canManage && <AddVehicleDialog />}
      </div>

      <Card>
        <CardContent className="p-0">
          {vehicles.length === 0 ? (
            <EmptyState
              icon={Truck}
              title="لا توجد مركبات"
              description={canManage ? "أضف أول مركبة للبدء." : undefined}
              className="border-0"
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>المركبة</TableHead>
                  <TableHead>رقم اللوحة</TableHead>
                  <TableHead>نوع الوقود</TableHead>
                  <TableHead>المسؤول الحالي</TableHead>
                  <TableHead>القيمة التقديرية</TableHead>
                  <TableHead>الحالة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vehicles.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell className="font-medium text-foreground">
                      <Link href={`/vehicles/${v.id}`} className="hover:underline">
                        {v.name}
                      </Link>
                    </TableCell>
                    <TableCell dir="ltr" className="text-end text-muted-foreground">
                      {v.plateNumber}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {FUEL_TYPE_LABEL_AR[v.fuelType]}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {v.responsibleUserName ?? "—"}
                    </TableCell>
                    <TableCell dir="ltr" className="text-end text-muted-foreground">
                      {v.estimatedValue ? formatILS(v.estimatedValue) : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={v.isActive ? "success" : "outline"}>
                        {v.isActive ? "نشطة" : "غير نشطة"}
                      </Badge>
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
