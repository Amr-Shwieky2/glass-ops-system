import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Wallet2, History, Fuel } from "lucide-react";
import { getCurrentUser } from "@/server/auth/session";
import { can, canAny } from "@/server/auth/permissions";
import { PERMISSIONS } from "@/server/auth/permission-keys";
import { getVehicleDetail, getFuelLogsForVehicle } from "@/server/vehicles/queries";
import { getAssignableUsers } from "@/server/jobs/queries";
import { formatILS } from "@/server/money";
import { Forbidden } from "@/components/forbidden";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FUEL_TYPE_LABEL_AR } from "../fuel-type";
import { AddFuelDialog } from "../add-fuel-dialog";
import { EditVehicleDialog } from "./edit-vehicle-dialog";
import { AssignResponsibilityDialog } from "./assign-responsibility-dialog";

const dateFmt = new Intl.DateTimeFormat("ar", {
  year: "numeric",
  month: "short",
  day: "numeric",
  numberingSystem: "latn",
});

const dateTimeFmt = new Intl.DateTimeFormat("ar", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  numberingSystem: "latn",
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const vehicle = await getVehicleDetail(id);
  return { title: `${vehicle?.name ?? "مركبة"} | نظام إدارة عمليات الزجاج` };
}

export default async function VehicleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!canAny(user, [PERMISSIONS.MANAGE_VEHICLES, PERMISSIONS.ADD_FUEL])) {
    return <Forbidden />;
  }

  const vehicle = await getVehicleDetail(id);
  if (!vehicle) notFound();

  const canManage = can(user, PERMISSIONS.MANAGE_VEHICLES);
  const canAddFuel = can(user, PERMISSIONS.ADD_FUEL);

  const [assignableUsers, fuelLogs] = await Promise.all([
    canManage ? getAssignableUsers() : Promise.resolve([]),
    getFuelLogsForVehicle(vehicle.id),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ms-2 mb-2">
          <Link href="/vehicles">
            <ArrowLeft className="size-4 rotate-180" />
            المركبات والوقود
          </Link>
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold text-foreground">{vehicle.name}</h1>
              <Badge variant={vehicle.isActive ? "success" : "outline"}>
                {vehicle.isActive ? "نشطة" : "غير نشطة"}
              </Badge>
            </div>
            <p dir="ltr" className="text-end text-sm text-muted-foreground">
              {vehicle.plateNumber} · {FUEL_TYPE_LABEL_AR[vehicle.fuelType]}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canManage && <EditVehicleDialog vehicle={vehicle} />}
            {canManage && (
              <AssignResponsibilityDialog vehicleId={vehicle.id} assignableUsers={assignableUsers} />
            )}
            {canAddFuel && (
              <AddFuelDialog
                vehicles={[{ id: vehicle.id, name: vehicle.name, plateNumber: vehicle.plateNumber }]}
                defaultVehicleId={vehicle.id}
                trigger={
                  <Button size="sm">
                    <Fuel className="size-4" />
                    إضافة وقود
                  </Button>
                }
              />
            )}
          </div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Wallet2 className="size-5 text-muted-foreground" />
            ملخص التكاليف
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-3">
            <div>
              <p className="text-muted-foreground">وقود هذا الشهر</p>
              <p dir="ltr" className="text-end text-xl font-bold text-foreground">
                {formatILS(vehicle.costSummary.monthlyFuelTotal)}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">إجمالي تكلفة التشغيل</p>
              <p dir="ltr" className="text-end text-xl font-bold text-foreground">
                {formatILS(vehicle.costSummary.totalRunningCost)}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">القيمة التقديرية</p>
              <p dir="ltr" className="text-end text-xl font-bold text-foreground">
                {vehicle.estimatedValue ? formatILS(vehicle.estimatedValue) : "—"}
              </p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            إجمالي تكلفة التشغيل يشمل الوقود فقط حالياً — لا يوجد سجل صيانة أو تكاليف أخرى
            للمركبات في النظام بعد.
          </p>
          {vehicle.notes && (
            <p className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
              {vehicle.notes}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="size-5 text-muted-foreground" />
            سجل المسؤولية
          </CardTitle>
        </CardHeader>
        <CardContent>
          {vehicle.history.length === 0 ? (
            <EmptyState title="لا يوجد سجل مسؤولية لهذه المركبة" className="border-0 p-6" />
          ) : (
            <ul className="divide-y">
              {vehicle.history.map((h) => (
                <li key={h.id} className="flex items-center justify-between gap-3 py-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-foreground">{h.userName}</span>
                      {h.endDate === null && <Badge variant="success">الحالي</Badge>}
                    </div>
                    <p dir="ltr" className="text-end text-sm text-muted-foreground">
                      {dateFmt.format(new Date(h.startDate))} —{" "}
                      {h.endDate ? dateFmt.format(new Date(h.endDate)) : "الآن"}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Fuel className="size-5 text-muted-foreground" />
            سجل الوقود
          </CardTitle>
        </CardHeader>
        <CardContent>
          {fuelLogs.length === 0 ? (
            <EmptyState title="لا توجد عمليات تعبئة وقود مسجلة" className="border-0 p-6" />
          ) : (
            <ul className="divide-y">
              {fuelLogs.map((log) => (
                <li key={log.id} className="space-y-1 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium text-foreground">
                      {FUEL_TYPE_LABEL_AR[log.fuelType]}
                    </span>
                    <span dir="ltr" className="text-end font-medium text-foreground">
                      {formatILS(log.amount)}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {log.addedByUserName} · {dateTimeFmt.format(log.loggedAt)}
                  </p>
                  {(log.liters || log.mileage !== null) && (
                    <p dir="ltr" className="text-end text-sm text-muted-foreground">
                      {log.liters ? `${log.liters} لتر` : ""}
                      {log.liters && log.mileage !== null ? " · " : ""}
                      {log.mileage !== null ? `العداد: ${log.mileage}` : ""}
                    </p>
                  )}
                  {log.notes && <p className="text-sm text-muted-foreground">{log.notes}</p>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
