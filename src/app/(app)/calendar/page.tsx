import type { Metadata } from "next";
import { getCurrentUser } from "@/server/auth/session";
import { can, canAny } from "@/server/auth/permissions";
import { PERMISSIONS } from "@/server/auth/permission-keys";
import { getAssignableUsers } from "@/server/jobs/queries";
import { Forbidden } from "@/components/forbidden";
import { CalendarView } from "./calendar-view";

export const metadata: Metadata = {
  title: "التقويم | نظام إدارة عمليات الزجاج",
};

export default async function CalendarPage() {
  const user = await getCurrentUser();
  if (!canAny(user, [PERMISSIONS.VIEW_ALL_JOBS, PERMISSIONS.VIEW_ASSIGNED_JOBS])) {
    return <Forbidden />;
  }

  const canViewAll = can(user, PERMISSIONS.VIEW_ALL_JOBS);
  const assignableUsers = canViewAll ? await getAssignableUsers() : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">التقويم</h1>
        <p className="text-sm text-muted-foreground">
          {canViewAll ? "مواعيد جميع الفنيين" : "مواعيدك المجدولة"}
        </p>
      </div>

      <CalendarView canViewAll={canViewAll} assignableUsers={assignableUsers} />
    </div>
  );
}
