"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Pencil } from "lucide-react";
import { updateCompensationRuleAction, type ActionState } from "@/server/lookups/actions";
import type { CompensationRuleAdminRow } from "@/server/lookups/queries";
import { useCloseOnSuccess } from "@/lib/use-close-on-success";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

const initialState: ActionState = {};
const NONE = "none";

const UNIT_OPTIONS = [
  { value: "meter", label: "بالمتر" },
  { value: "unit", label: "بالقطعة" },
  { value: "job", label: "بالمهمة" },
  { value: "day", label: "باليوم" },
];

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "جارٍ الحفظ..." : "حفظ التعديلات"}
    </Button>
  );
}

/**
 * Deactivate-only, no in-use guard on the backend — past ledger entries
 * snapshot their own rateUsed, so this is safe to flip without checking
 * usage (see updateCompensationRuleAction's doc comment).
 */
export function EditCompensationRuleDialog({
  rule,
  workTypes,
}: {
  rule: CompensationRuleAdminRow;
  workTypes: { id: string; labelAr: string }[];
}) {
  const [open, setOpen] = React.useState(false);
  const [workTypeId, setWorkTypeId] = React.useState(rule.workTypeId ?? NONE);
  const action = updateCompensationRuleAction.bind(null, rule.id);
  const [state, formAction] = useActionState(action, initialState);

  useCloseOnSuccess(state, setOpen);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setWorkTypeId(rule.workTypeId ?? NONE);
      }}
    >
      <DialogTrigger asChild>
        <Button size="icon" variant="ghost" className="size-8" aria-label="تعديل القاعدة">
          <Pencil className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>تعديل قاعدة التعويض</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="label">اسم القاعدة *</Label>
            <Input id="label" name="label" defaultValue={rule.label} required />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="unit">الوحدة *</Label>
              <Select name="unit" required defaultValue={rule.unit}>
                <SelectTrigger id="unit">
                  <SelectValue placeholder="اختر الوحدة" />
                </SelectTrigger>
                <SelectContent>
                  {UNIT_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="amount">المبلغ (₪) *</Label>
              <Input
                id="amount"
                name="amount"
                type="text"
                inputMode="decimal"
                dir="ltr"
                defaultValue={rule.amount}
                required
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="workTypeId">نوع العمل المرتبط (اختياري)</Label>
            <Select value={workTypeId} onValueChange={setWorkTypeId}>
              <SelectTrigger id="workTypeId">
                <SelectValue placeholder="بدون ربط بنوع عمل محدد" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>بدون ربط بنوع عمل محدد</SelectItem>
                {workTypes.map((wt) => (
                  <SelectItem key={wt.id} value={wt.id}>
                    {wt.labelAr}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {workTypeId !== NONE && (
              <input type="hidden" name="workTypeId" value={workTypeId} />
            )}
          </div>

          <input type="hidden" name="isActive" value={rule.isActive ? "true" : "false"} />

          {state.error && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {state.error}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              إلغاء
            </Button>
            <SubmitButton />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
