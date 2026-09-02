"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Pencil } from "lucide-react";
import type { ActionState } from "@/server/lookups/actions";
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
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

export interface SimpleRuleRow {
  id: string;
  label: string;
  defaultAmount: string;
  description: string | null;
  isActive: boolean;
}

const initialState: ActionState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "جارٍ الحفظ..." : "حفظ التعديلات"}
    </Button>
  );
}

/** Shared edit dialog for penalty/bonus rules — see AddSimpleRuleDialog. */
export function EditSimpleRuleDialog({
  rule,
  updateAction,
  dialogTitle,
}: {
  rule: SimpleRuleRow;
  updateAction: (
    id: string,
    prevState: ActionState,
    formData: FormData,
  ) => Promise<ActionState>;
  dialogTitle: string;
}) {
  const [open, setOpen] = React.useState(false);
  const action = updateAction.bind(null, rule.id);
  const [state, formAction] = useActionState(action, initialState);

  useCloseOnSuccess(state, setOpen);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="icon" variant="ghost" className="size-8" aria-label="تعديل القاعدة">
          <Pencil className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="label">اسم القاعدة *</Label>
            <Input id="label" name="label" defaultValue={rule.label} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="defaultAmount">المبلغ الافتراضي (₪) *</Label>
            <Input
              id="defaultAmount"
              name="defaultAmount"
              type="text"
              inputMode="decimal"
              dir="ltr"
              defaultValue={rule.defaultAmount}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">الوصف (اختياري)</Label>
            <Textarea id="description" name="description" defaultValue={rule.description ?? ""} />
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
