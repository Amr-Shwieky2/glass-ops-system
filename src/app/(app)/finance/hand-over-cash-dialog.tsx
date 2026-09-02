"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { HandCoins } from "lucide-react";
import { createCashTransfer, type ActionState } from "@/server/finance/transfer-actions";
import { useCloseOnSuccess } from "@/lib/use-close-on-success";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

const initialState: ActionState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "جارٍ الحفظ..." : "تسليم"}
    </Button>
  );
}

/**
 * Any logged-in user may report handing over cash they're personally
 * holding — not gated by a permission, since anyone with COLLECT_PAYMENT
 * could be sitting on company cash (section 35). V1 only supports handing
 * it to the company account (createCashTransfer's toAccountKind).
 */
export function HandOverCashDialog() {
  const [open, setOpen] = React.useState(false);
  const [state, formAction] = useActionState(createCashTransfer, initialState);

  useCloseOnSuccess(state, setOpen);

  const [prevState, setPrevState] = React.useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state.success) toast.success("تم تسجيل عملية التسليم، بانتظار التأكيد.");
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <HandCoins className="size-4" />
          تسليم نقدية
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>تسليم نقدية للشركة</DialogTitle>
          <DialogDescription>
            سجّل تسليم النقدية التي بحوزتك — سيبقى الطلب بانتظار تأكيد الاستلام.
          </DialogDescription>
        </DialogHeader>
        <form action={formAction} className="space-y-4" noValidate>
          <input type="hidden" name="toAccountKind" value="company" />
          <div className="space-y-2">
            <Label htmlFor="transfer-amount">المبلغ *</Label>
            <Input
              id="transfer-amount"
              name="amount"
              type="text"
              inputMode="decimal"
              dir="ltr"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="transfer-notes">ملاحظات (اختياري)</Label>
            <Textarea id="transfer-notes" name="notes" />
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
