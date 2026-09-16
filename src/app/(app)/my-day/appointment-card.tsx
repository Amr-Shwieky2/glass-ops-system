import Link from "next/link";
import { ArrowLeft, MapPin } from "lucide-react";
import type { MyDayAppointment } from "@/server/appointments/queries";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LocationButtons } from "@/components/location-buttons";
import { CompleteInstallationDialog } from "./complete-installation-dialog";
import { ArrivedButton } from "./arrived-button";
import { AddFieldNoteDialog } from "./add-field-note-dialog";
import { AddPaymentDialog } from "../jobs/[id]/add-payment-dialog";

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
  canCollectPayment,
}: {
  appointment: MyDayAppointment;
  canCompleteInstallation: boolean;
  canCollectPayment: boolean;
}) {
  const a = appointment;
  // 'arrived' is a valid pre-completion state too (arrival tracking is
  // optional — a technician can complete straight from 'scheduled').
  const canComplete =
    canCompleteInstallation &&
    a.type === "installation" &&
    (a.status === "scheduled" || a.status === "arrived");
  // getMyDayAppointments only ever returns appointments the current user is
  // assigned to (see its exists() clause in queries.ts), so every card
  // rendered here already satisfies "current user is one of its
  // assignees" — no separate prop needed for that half of the gate.
  const canMarkArrived = a.status === "scheduled";

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
          size="default"
        />

        {a.status === "arrived" && a.arrivedAt && (
          <p className="flex items-center gap-1.5 text-sm font-medium text-success">
            <MapPin className="size-4" />
            وصلت الموقع الساعة {timeFmt.format(a.arrivedAt)}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button variant="outline" asChild>
            <Link href={`/jobs/${a.jobId}`}>
              فتح المهمة
              <ArrowLeft className="size-4 rotate-180" />
            </Link>
          </Button>
          {canMarkArrived && <ArrivedButton appointmentId={a.id} />}
          <AddFieldNoteDialog jobId={a.jobId} />
          {canCollectPayment && <AddPaymentDialog jobId={a.jobId} triggerLabel="جمع دفعة" />}
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
