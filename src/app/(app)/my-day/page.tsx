import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { PERMISSIONS } from "@/server/auth/permission-keys";
import { getMyDayAppointments } from "@/server/appointments/queries";
import { getVehiclesList } from "@/server/vehicles/queries";
import { getTodayRangeUtc } from "@/lib/company-day";
import { EmptyState } from "@/components/ui/empty-state";
import { CalendarCheck } from "lucide-react";
import { AppointmentCard } from "./appointment-card";
import { AddFuelQuickAction } from "./add-fuel-quick-action";

export const metadata: Metadata = {
  title: "يومي | نظام إدارة عمليات الزجاج",
};

const dateFmt = new Intl.DateTimeFormat("ar", {
  weekday: "long",
  year: "numeric",
  month: "long",
  day: "numeric",
  numberingSystem: "latn",
});

export default async function MyDayPage() {
  // Auth is already enforced by src/app/(app)/layout.tsx (redirects to
  // /login if unauthenticated) — no additional permission gate here, any
  // signed-in user has their own day.
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { start, end } = getTodayRangeUtc();
  const canCompleteInstallation = can(user, PERMISSIONS.COMPLETE_INSTALLATION);
  const canAddFuel = can(user, PERMISSIONS.ADD_FUEL);

  const [appointments, vehicles] = await Promise.all([
    getMyDayAppointments(user.id, start, end),
    canAddFuel ? getVehiclesList() : Promise.resolve([]),
  ]);
  const activeVehicles = vehicles.filter((v) => v.isActive);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">يومي</h1>
        <p className="text-sm text-muted-foreground">{dateFmt.format(new Date())}</p>
      </div>

      {appointments.length === 0 ? (
        <EmptyState icon={CalendarCheck} title="لا توجد مواعيد اليوم" />
      ) : (
        <div className="space-y-3">
          {appointments.map((a) => (
            <AppointmentCard
              key={a.id}
              appointment={a}
              canCompleteInstallation={canCompleteInstallation}
            />
          ))}
        </div>
      )}

      {canAddFuel && activeVehicles.length > 0 && (
        <AddFuelQuickAction vehicles={activeVehicles} defaultVehicleId={user.defaultVehicleId} />
      )}
    </div>
  );
}
