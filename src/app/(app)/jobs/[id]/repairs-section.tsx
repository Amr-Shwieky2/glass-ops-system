import { Wrench } from "lucide-react";
import type { Repair } from "@/server/repairs/queries";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { CreateRepairDialog } from "./create-repair-dialog";
import { RepairStatusControl } from "./repair-status-control";

const dateFmt = new Intl.DateTimeFormat("ar", {
  year: "numeric",
  month: "short",
  day: "numeric",
  numberingSystem: "latn",
});

const STATUS_LABEL_AR: Record<Repair["status"], string> = {
  open: "مفتوح",
  scheduled: "مجدول",
  in_progress: "قيد التنفيذ",
  resolved: "تم الحل",
};

const STATUS_VARIANT: Record<
  Repair["status"],
  "destructive" | "warning" | "info" | "success"
> = {
  open: "destructive",
  scheduled: "warning",
  in_progress: "info",
  resolved: "success",
};

export function RepairsSection({
  jobId,
  repairs,
  assignableUsers,
  responsibleUserNameById,
}: {
  jobId: string;
  repairs: Repair[];
  assignableUsers: { id: string; name: string }[];
  responsibleUserNameById: Record<string, string>;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <Wrench className="size-5 text-muted-foreground" />
          الإصلاحات (تيكون)
        </CardTitle>
        <CreateRepairDialog jobId={jobId} assignableUsers={assignableUsers} />
      </CardHeader>
      <CardContent>
        {repairs.length === 0 ? (
          <EmptyState title="لا توجد إصلاحات مسجلة على هذه المهمة" className="border-0 p-6" />
        ) : (
          <ul className="divide-y">
            {repairs.map((r) => (
              <li key={r.id} className="space-y-2 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Badge variant={STATUS_VARIANT[r.status]}>
                        {STATUS_LABEL_AR[r.status]}
                      </Badge>
                      <span className="text-sm text-muted-foreground">
                        {dateFmt.format(new Date(r.dateReported))}
                      </span>
                    </div>
                    <p className="font-medium text-foreground">{r.problemDescription}</p>
                    <p className="text-sm text-muted-foreground">
                      {r.responsibleUserId
                        ? `المسؤول: ${responsibleUserNameById[r.responsibleUserId] ?? "—"}`
                        : "بدون مسؤول محدد"}
                      {r.scheduledDate
                        ? ` · الموعد: ${dateFmt.format(new Date(r.scheduledDate))}`
                        : ""}
                    </p>
                    {r.notes && <p className="text-sm text-muted-foreground">{r.notes}</p>}
                  </div>
                  <RepairStatusControl
                    repairId={r.id}
                    status={r.status}
                    scheduledDate={r.scheduledDate}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
