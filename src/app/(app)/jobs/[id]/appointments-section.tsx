import { CalendarClock } from "lucide-react";
import type { JobAppointment } from "@/server/appointments/queries";
import { cancelAppointmentAction } from "@/server/appointments/actions";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmRemoveButton } from "./confirm-remove-button";
import { ScheduleAppointmentDialog } from "./schedule-appointment-dialog";

const dateTimeFmt = new Intl.DateTimeFormat("ar", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  numberingSystem: "latn",
});

const APPOINTMENT_TYPE_LABEL_AR: Record<string, string> = {
  measurement: "قياس",
  installation: "تركيب",
  repair: "إصلاح",
  customer_meeting: "لقاء عميل",
  other: "أخرى",
};

const APPOINTMENT_STATUS_LABEL_AR: Record<string, string> = {
  scheduled: "مجدول",
  arrived: "وصل الموقع",
  completed: "مكتمل",
  cancelled: "ملغى",
};

const APPOINTMENT_STATUS_VARIANT: Record<
  string,
  "info" | "success" | "outline"
> = {
  scheduled: "info",
  arrived: "info",
  completed: "success",
  cancelled: "outline",
};

export function AppointmentsSection({
  jobId,
  appointments,
  assignableUsers,
  canScheduleAppointment,
}: {
  jobId: string;
  appointments: JobAppointment[];
  assignableUsers: { id: string; name: string }[];
  canScheduleAppointment: boolean;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarClock className="size-5 text-muted-foreground" />
          الجدولة
        </CardTitle>
        {canScheduleAppointment && (
          <ScheduleAppointmentDialog jobId={jobId} assignableUsers={assignableUsers} />
        )}
      </CardHeader>
      <CardContent>
        {appointments.length === 0 ? (
          <EmptyState title="لا توجد مواعيد لهذه المهمة بعد" className="border-0 p-6" />
        ) : (
          <ul className="divide-y">
            {appointments.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 py-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground">
                      {APPOINTMENT_TYPE_LABEL_AR[a.type] ?? a.type}
                    </span>
                    <Badge variant={APPOINTMENT_STATUS_VARIANT[a.status] ?? "outline"}>
                      {APPOINTMENT_STATUS_LABEL_AR[a.status] ?? a.status}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {dateTimeFmt.format(a.scheduledStart)}
                    {a.scheduledEnd && ` – ${dateTimeFmt.format(a.scheduledEnd)}`}
                  </p>
                  {a.assigneeNames.length > 0 && (
                    <p className="text-sm text-muted-foreground">
                      {a.assigneeNames.join("، ")}
                    </p>
                  )}
                </div>
                {a.status === "scheduled" && (
                  <ConfirmRemoveButton
                    title="إلغاء الموعد"
                    description="سيتم إلغاء هذا الموعد."
                    onConfirm={cancelAppointmentAction.bind(null, jobId, a.id)}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
