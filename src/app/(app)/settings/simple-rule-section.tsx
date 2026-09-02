"use client";

import type { LucideIcon } from "lucide-react";
import type { ActionState } from "@/server/lookups/actions";
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
import { ActiveToggle } from "./active-toggle";
import { AddSimpleRuleDialog } from "./add-simple-rule-dialog";
import { EditSimpleRuleDialog, type SimpleRuleRow } from "./edit-simple-rule-dialog";

function toFormData(rule: SimpleRuleRow, isActive: boolean): FormData {
  const fd = new FormData();
  fd.set("label", rule.label);
  fd.set("defaultAmount", rule.defaultAmount);
  fd.set("description", rule.description ?? "");
  fd.set("isActive", isActive ? "true" : "false");
  return fd;
}

/**
 * Shared table+dialogs section for penalty rules (30) and bonus rules
 * (31) — identical shape and behavior on the backend (label /
 * defaultAmount / description, deactivate-only, no in-use guard since a
 * past ledger entry snapshots its own amount), so one generic section is
 * reused for both from page.tsx rather than duplicating the same table
 * twice.
 */
export function SimpleRuleSection({
  rules,
  icon,
  title,
  description,
  emptyTitle,
  addTriggerLabel,
  addDialogTitle,
  editDialogTitle,
  createAction,
  updateAction,
}: {
  rules: SimpleRuleRow[];
  icon: LucideIcon;
  title: string;
  description: string;
  emptyTitle: string;
  addTriggerLabel: string;
  addDialogTitle: string;
  editDialogTitle: string;
  createAction: (prevState: ActionState, formData: FormData) => Promise<ActionState>;
  updateAction: (
    id: string,
    prevState: ActionState,
    formData: FormData,
  ) => Promise<ActionState>;
}) {
  const Icon = icon;
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        <AddSimpleRuleDialog
          createAction={createAction}
          triggerLabel={addTriggerLabel}
          dialogTitle={addDialogTitle}
        />
      </CardHeader>
      <CardContent className="p-0">
        {rules.length === 0 ? (
          <EmptyState icon={Icon} title={emptyTitle} className="border-0" />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>اسم القاعدة</TableHead>
                  <TableHead>المبلغ الافتراضي</TableHead>
                  <TableHead>الوصف</TableHead>
                  <TableHead>مفعّلة</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules.map((rule) => (
                  <TableRow key={rule.id}>
                    <TableCell className="font-medium text-foreground">{rule.label}</TableCell>
                    <TableCell dir="ltr" className="text-end text-muted-foreground">
                      {formatILS(rule.defaultAmount)}
                    </TableCell>
                    <TableCell className="max-w-xs truncate text-muted-foreground">
                      {rule.description ?? "—"}
                    </TableCell>
                    <TableCell>
                      <ActiveToggle
                        checked={rule.isActive}
                        onToggle={(next) => updateAction(rule.id, {}, toFormData(rule, next))}
                      />
                    </TableCell>
                    <TableCell>
                      <EditSimpleRuleDialog
                        rule={rule}
                        updateAction={updateAction}
                        dialogTitle={editDialogTitle}
                      />
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
