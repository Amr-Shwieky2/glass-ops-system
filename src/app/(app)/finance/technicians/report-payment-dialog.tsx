"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { reportTechnicianPayment, type ActionState } from "@/server/compensation/actions";
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
      {pending ? "جارٍ الحفظ..." : "إرسال"}
    </Button>
  );
}

/**
 * Only ever shown on a viewer's own ledger page — reportTechnicianPayment
 * always books against getCurrentUser() server-side, never a form field,
 * so there's nothing here that lets it be used for anyone else.
 */
export function ReportPaymentDialog() {
  const [open, setOpen] = React.useState(false);
  const [state, formAction] = useActionState(reportTechnicianPayment, initialState);

  useCloseOnSuccess(state, setOpen);

  const [prevState, setPrevState] = React.useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state.success) toast.success("تم إرسال البلاغ.");
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus className="size-4" />
          الإبلاغ عن دفعة مستلمة
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>الإبلاغ عن دفعة مستلمة من الشركة</DialogTitle>
          <DialogDescription>
            سيتم خصم المبلغ من رصيدك المستحق فور اعتماد البلاغ.
          </DialogDescription>
        </DialogHeader>
        <form action={formAction} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="report-amount">المبلغ *</Label>
            <Input id="report-amount" name="amount" type="text" inputMode="decimal" dir="ltr" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="report-note">ملاحظة (اختياري)</Label>
            <Textarea id="report-note" name="note" />
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
