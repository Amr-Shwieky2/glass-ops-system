import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { MyDayAppointment } from "@/server/appointments/queries";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LocationButtons } from "@/components/location-buttons";
import { CompleteInstallationDialog } from "./complete-installation-dialog";

const timeFmt = new Intl.DateTimeFormat("ar", {
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

const APPOINTMENT_TYPE_VARIANT: Record<
  string,
  "info" | "success" | "destructive" | "primary" | "outline"
> = {
  measurement: "info",
  installation: "success",
  repair: "destructive",
  customer_meeting: "primary",
  other: "outline",
};

export function AppointmentCard({
  appointment,
  canCompleteInstallation,
}: {
  appointment: MyDayAppointment;
  canCompleteInstallation: boolean;
}) {
  const a = appointment;
  const canComplete =
    canCompleteInstallation && a.type === "installation" && a.status === "scheduled";

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <span dir="ltr" className="text-lg font-bold text-foreground">
            {timeFmt.format(a.scheduledStart)}
          </span>
          <Badge variant={APPOINTMENT_TYPE_VARIANT[a.type] ?? "outline"}>
            {APPOINTMENT_TYPE_LABEL_AR[a.type] ?? a.type}
          </Badge>
        </div>

        <div>
          <p className="font-medium text-foreground">{a.customerName}</p>
          <p className="text-sm text-muted-foreground">
            {a.jobNumber}
            {a.jobTitle && ` · ${a.jobTitle}`}
          </p>
        </div>

        {a.assigneeNames.length > 1 && (
          <p className="text-sm text-muted-foreground">مع {a.assigneeNames.join("، ")}</p>
        )}

        <LocationButtons
          phone={a.customerPhone}
          address={a.location ?? a.customerAddress}
          latitude={a.jobLatitude ?? a.customerLatitude}
          longitude={a.jobLongitude ?? a.customerLongitude}
          googleMapsUrl={a.customerGoogleMapsUrl}
        />

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button size="sm" variant="outline" asChild>
            <Link href={`/jobs/${a.jobId}`}>
              فتح المهمة
              <ArrowLeft className="size-4 rotate-180" />
            </Link>
          </Button>
          {canComplete && (
            <CompleteInstallationDialog
              appointmentId={a.id}
              pendingItems={a.pendingItems}
            />
          )}
        </div>
      </CardContent>
    </Card>
  );
}
