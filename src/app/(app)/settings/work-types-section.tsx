"use client";

import { updateWorkTypeAction } from "@/server/lookups/actions";
import { unitLabelAr } from "@/lib/units";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { Layers } from "lucide-react";
import { ActiveToggle } from "./active-toggle";
import { AddWorkTypeDialog } from "./add-work-type-dialog";
import { EditWorkTypeDialog, type WorkTypeRow } from "./edit-work-type-dialog";

function toFormData(workType: WorkTypeRow, isActive: boolean): FormData {
  const fd = new FormData();
  fd.set("labelEn", workType.labelEn);
  fd.set("labelAr", workType.labelAr);
  fd.set("defaultUnit", workType.defaultUnit);
  fd.set("sortOrder", String(workType.sortOrder));
  fd.set("isActive", isActive ? "true" : "false");
  return fd;
}

export function WorkTypesSection({ workTypes }: { workTypes: WorkTypeRow[] }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>أنواع العمل</CardTitle>
          <CardDescription>
            المفتاح غير قابل للتعديل بعد الإنشاء — تعطيل نوع عمل مستخدَم حالياً في بنود مهام أو
            قواعد تعويض غير ممكن.
          </CardDescription>
        </div>
        <AddWorkTypeDialog />
      </CardHeader>
      <CardContent className="p-0">
        {workTypes.length === 0 ? (
          <EmptyState icon={Layers} title="لا توجد أنواع عمل" className="border-0" />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>المفتاح</TableHead>
                  <TableHead>التسمية بالعربية</TableHead>
                  <TableHead>التسمية بالإنجليزية</TableHead>
                  <TableHead>الوحدة الافتراضية</TableHead>
                  <TableHead>الترتيب</TableHead>
                  <TableHead>مفعّل</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {workTypes.map((wt) => (
                  <TableRow key={wt.id}>
                    <TableCell dir="ltr" className="text-end font-mono text-xs text-muted-foreground">
                      {wt.key}
                    </TableCell>
                    <TableCell className="font-medium text-foreground">{wt.labelAr}</TableCell>
                    <TableCell dir="ltr" className="text-end text-muted-foreground">
                      {wt.labelEn}
                    </TableCell>
                    <TableCell className="text-end text-muted-foreground">
                      {unitLabelAr(wt.defaultUnit)}
                    </TableCell>
                    <TableCell dir="ltr" className="text-end text-muted-foreground">
                      {wt.sortOrder}
                    </TableCell>
                    <TableCell>
                      <ActiveToggle
                        checked={wt.isActive}
                        onToggle={(next) => updateWorkTypeAction(wt.id, {}, toFormData(wt, next))}
                      />
                    </TableCell>
                    <TableCell>
                      <EditWorkTypeDialog workType={wt} />
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
