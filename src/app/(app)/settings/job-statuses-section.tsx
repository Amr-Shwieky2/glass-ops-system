"use client";

import { updateJobStatusAction } from "@/server/lookups/actions";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { ListChecks } from "lucide-react";
import { ActiveToggle } from "./active-toggle";
import { AddJobStatusDialog } from "./add-job-status-dialog";
import { EditJobStatusDialog, type JobStatusRow } from "./edit-job-status-dialog";

function toFormData(status: JobStatusRow, isActive: boolean): FormData {
  const fd = new FormData();
  fd.set("labelEn", status.labelEn);
  fd.set("labelAr", status.labelAr);
  fd.set("sortOrder", String(status.sortOrder));
  fd.set("color", status.color ?? "");
  fd.set("isActive", isActive ? "true" : "false");
  return fd;
}

export function JobStatusesSection({ statuses }: { statuses: JobStatusRow[] }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>حالات المهام</CardTitle>
          <CardDescription>
            المفتاح يستخدمه النظام داخلياً للتعرف على كل حالة وهو غير قابل للتعديل بعد الإنشاء،
            وكذلك كون الحالة نهائية — لتفادي كسر منطق تتبع المهام في أماكن أخرى من النظام.
          </CardDescription>
        </div>
        <AddJobStatusDialog />
      </CardHeader>
      <CardContent className="p-0">
        {statuses.length === 0 ? (
          <EmptyState icon={ListChecks} title="لا توجد حالات مهام" className="border-0" />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>المفتاح</TableHead>
                  <TableHead>التسمية بالعربية</TableHead>
                  <TableHead>التسمية بالإنجليزية</TableHead>
                  <TableHead>الترتيب</TableHead>
                  <TableHead>نهائية</TableHead>
                  <TableHead>اللون</TableHead>
                  <TableHead>مفعّلة</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {statuses.map((status) => (
                  <TableRow key={status.id}>
                    <TableCell dir="ltr" className="text-end font-mono text-xs text-muted-foreground">
                      {status.key}
                    </TableCell>
                    <TableCell className="font-medium text-foreground">{status.labelAr}</TableCell>
                    <TableCell dir="ltr" className="text-end text-muted-foreground">
                      {status.labelEn}
                    </TableCell>
                    <TableCell dir="ltr" className="text-end text-muted-foreground">
                      {status.sortOrder}
                    </TableCell>
                    <TableCell>
                      <Badge variant={status.isTerminal ? "primary" : "outline"}>
                        {status.isTerminal ? "نهائية" : "—"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {status.color ? (
                        <span className="flex items-center gap-2">
                          <span
                            className="inline-block size-3 rounded-full border"
                            style={{ backgroundColor: status.color }}
                          />
                          <span dir="ltr" className="text-xs text-muted-foreground">
                            {status.color}
                          </span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <ActiveToggle
                        checked={status.isActive}
                        onToggle={(next) =>
                          updateJobStatusAction(status.id, {}, toFormData(status, next))
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <EditJobStatusDialog status={status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
