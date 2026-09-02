"use client";

import { updateCompensationRuleAction } from "@/server/lookups/actions";
import type { CompensationRuleAdminRow } from "@/server/lookups/queries";
import { formatILS } from "@/server/money";
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
import { Wallet2 } from "lucide-react";
import { ActiveToggle } from "./active-toggle";
import { AddCompensationRuleDialog } from "./add-compensation-rule-dialog";
import { EditCompensationRuleDialog } from "./edit-compensation-rule-dialog";

const UNIT_LABEL_AR: Record<string, string> = {
  meter: "بالمتر",
  unit: "بالقطعة",
  job: "بالمهمة",
  day: "باليوم",
};

function toFormData(rule: CompensationRuleAdminRow, isActive: boolean): FormData {
  const fd = new FormData();
  fd.set("label", rule.label);
  fd.set("unit", rule.unit);
  fd.set("amount", rule.amount);
  if (rule.workTypeId) fd.set("workTypeId", rule.workTypeId);
  fd.set("isActive", isActive ? "true" : "false");
  return fd;
}

export function CompensationRulesSection({
  rules,
  workTypes,
}: {
  rules: CompensationRuleAdminRow[];
  workTypes: { id: string; labelAr: string }[];
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>قواعد تعويض الفنيين</CardTitle>
          <CardDescription>
            تحدد قيمة ما يستحقه الفني عند إتمام عمل معين. تعطيل قاعدة لا يغيّر أي مبلغ سبق
            استحقاقه — كل عملية تعويض سابقة تحتفظ بالقيمة التي طُبّقت وقتها.
          </CardDescription>
        </div>
        <AddCompensationRuleDialog workTypes={workTypes} />
      </CardHeader>
      <CardContent className="p-0">
        {rules.length === 0 ? (
          <EmptyState icon={Wallet2} title="لا توجد قواعد تعويض" className="border-0" />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>اسم القاعدة</TableHead>
                  <TableHead>نوع العمل</TableHead>
                  <TableHead>الوحدة</TableHead>
                  <TableHead>المبلغ</TableHead>
                  <TableHead>مفعّلة</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules.map((rule) => (
                  <TableRow key={rule.id}>
                    <TableCell className="font-medium text-foreground">{rule.label}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {rule.workTypeLabelAr ?? "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {UNIT_LABEL_AR[rule.unit] ?? rule.unit}
                    </TableCell>
                    <TableCell dir="ltr" className="text-end text-muted-foreground">
                      {formatILS(rule.amount)}
                    </TableCell>
                    <TableCell>
                      <ActiveToggle
                        checked={rule.isActive}
                        onToggle={(next) =>
                          updateCompensationRuleAction(rule.id, {}, toFormData(rule, next))
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <EditCompensationRuleDialog rule={rule} workTypes={workTypes} />
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
