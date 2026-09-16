"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { addPaymentAction, type ActionState } from "@/server/payments/actions";
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
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

const initialState: ActionState = {};

const PAYMENT_METHOD_OPTIONS: { value: string; label: string }[] = [
  { value: "cash", label: "نقدية" },
  { value: "bank_transfer", label: "تحويل بنكي" },
  { value: "check", label: "شيك" },
  { value: "other", label: "أخرى" },
];

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "جارٍ الحفظ..." : "إضافة الدفعة"}
    </Button>
  );
}

export function AddPaymentDialog({
  jobId,
  triggerLabel = "إضافة دفعة",
}: {
  jobId: string;
  /** Sprint 8 (S8.3): My Day's standalone quick action reuses this exact
   * dialog/action but needs the master-prompt-named "جمع دفعة" wording
   * instead of the job page's own "إضافة دفعة" — everything else about
   * the dialog (fields, validation, permission check) is identical, so
   * this is a label override, not a second component. */
  triggerLabel?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const action = addPaymentAction.bind(null, jobId);
  const [state, formAction] = useActionState(action, initialState);

  useCloseOnSuccess(state, setOpen);

  const [prevState, setPrevState] = React.useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state.success) toast.success("تم تسجيل الدفعة.");
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus className="size-4" />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>إضافة دفعة عميل</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="amount">المبلغ *</Label>
            <Input id="amount" name="amount" type="text" inputMode="decimal" dir="ltr" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="method">طريقة الدفع *</Label>
            <Select name="method" required defaultValue="cash">
              <SelectTrigger id="method">
                <SelectValue placeholder="اختر طريقة الدفع" />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_METHOD_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="notes">ملاحظات (اختياري)</Label>
            <Textarea id="notes" name="notes" />
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
            <SubmitButton />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
