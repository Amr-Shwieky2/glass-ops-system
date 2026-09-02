"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Plus } from "lucide-react";
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

const initialState: ActionState = {};

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "جارٍ الحفظ..." : label}
    </Button>
  );
}

/**
 * Shared create dialog for penalty rules (section 30) and bonus rules
 * (section 31) — both are, on the backend and here, the exact same shape
 * (label / defaultAmount / description), so one generic component takes
 * the create action and its Arabic copy rather than duplicating an
 * identical dialog twice.
 */
export function AddSimpleRuleDialog({
  createAction,
  triggerLabel,
  dialogTitle,
}: {
  createAction: (prevState: ActionState, formData: FormData) => Promise<ActionState>;
  triggerLabel: string;
  dialogTitle: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [state, formAction] = useActionState(createAction, initialState);

  useCloseOnSuccess(state, setOpen);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="size-4" />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="label">اسم القاعدة *</Label>
            <Input id="label" name="label" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="defaultAmount">المبلغ الافتراضي (₪) *</Label>
            <Input
              id="defaultAmount"
              name="defaultAmount"
              type="text"
              inputMode="decimal"
              dir="ltr"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">الوصف (اختياري)</Label>
            <Textarea id="description" name="description" />
          </div>

          {state.error && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {state.error}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              إلغاء
            </Button>
            <SubmitButton label={triggerLabel} />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
