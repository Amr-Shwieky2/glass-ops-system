"use client";

import { updateGlassTypeAction } from "@/server/lookups/actions";
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
import { Gem } from "lucide-react";
import { ActiveToggle } from "./active-toggle";
import { AddGlassTypeDialog } from "./add-glass-type-dialog";
import { EditGlassTypeDialog, type GlassTypeRow } from "./edit-glass-type-dialog";

function toFormData(glassType: GlassTypeRow, isActive: boolean): FormData {
  const fd = new FormData();
  fd.set("labelEn", glassType.labelEn);
  fd.set("labelAr", glassType.labelAr);
  fd.set("sortOrder", String(glassType.sortOrder));
  fd.set("isActive", isActive ? "true" : "false");
  return fd;
}

/** Master execution prompt Q4: glass type is a material property (its own
 * admin-editable list) distinct from the work-type category — see
 * src/server/db/schema/lookups.ts's glassTypes table and the New
 * Measurement quick-submit flow that references it. */
export function GlassTypesSection({ glassTypes }: { glassTypes: GlassTypeRow[] }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>أنواع الزجاج</CardTitle>
          <CardDescription>
            المفتاح غير قابل للتعديل بعد الإنشاء — تُستخدم هذه القائمة في نموذج القياس الميداني
            السريع (قياس جديد).
          </CardDescription>
        </div>
        <AddGlassTypeDialog />
      </CardHeader>
      <CardContent className="p-0">
        {glassTypes.length === 0 ? (
          <EmptyState icon={Gem} title="لا توجد أنواع زجاج" className="border-0" />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>المفتاح</TableHead>
                  <TableHead>التسمية بالعربية</TableHead>
                  <TableHead>التسمية بالإنجليزية</TableHead>
                  <TableHead>الترتيب</TableHead>
                  <TableHead>مفعّل</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {glassTypes.map((gt) => (
                  <TableRow key={gt.id}>
                    <TableCell dir="ltr" className="text-end font-mono text-xs text-muted-foreground">
                      {gt.key}
                    </TableCell>
                    <TableCell className="font-medium text-foreground">{gt.labelAr}</TableCell>
                    <TableCell dir="ltr" className="text-end text-muted-foreground">
                      {gt.labelEn}
                    </TableCell>
                    <TableCell dir="ltr" className="text-end text-muted-foreground">
                      {gt.sortOrder}
                    </TableCell>
                    <TableCell>
                      <ActiveToggle
                        checked={gt.isActive}
                        onToggle={(next) => updateGlassTypeAction(gt.id, {}, toFormData(gt, next))}
                      />
                    </TableCell>
                    <TableCell>
                      <EditGlassTypeDialog glassType={gt} />
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
