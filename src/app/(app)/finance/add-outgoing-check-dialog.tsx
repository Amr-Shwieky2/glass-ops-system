"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { createOutgoingCheckAction, type ActionState } from "@/server/checks/actions";
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
import { JobCombobox } from "./job-combobox";

const initialState: ActionState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "جارٍ الحفظ..." : "إضافة الشيك"}
    </Button>
  );
}

export function AddOutgoingCheckDialog() {
  const [open, setOpen] = React.useState(false);
  const [state, formAction] = useActionState(createOutgoingCheckAction, initialState);

  useCloseOnSuccess(state, setOpen);

  const [prevState, setPrevState] = React.useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state.success) toast.success("تم تسجيل الشيك الصادر.");
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus className="size-4" />
          شيك صادر
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>تسجيل شيك صادر عن الشركة</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="outgoing-payee">اسم المستفيد *</Label>
            <Input id="outgoing-payee" name="payeeName" required />
          </div>
          <div className="space-y-2">
            <Label>المهمة (اختياري)</Label>
            <JobCombobox name="jobId" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="outgoing-amount">المبلغ *</Label>
              <Input
                id="outgoing-amount"
                name="amount"
                type="text"
                inputMode="decimal"
                dir="ltr"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="outgoing-due-date">تاريخ الاستحقاق *</Label>
              <Input id="outgoing-due-date" name="dueDate" type="date" required />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="outgoing-check-number">رقم الشيك</Label>
            <Input id="outgoing-check-number" name="checkNumber" dir="ltr" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="outgoing-reason">السبب (اختياري)</Label>
            <Textarea id="outgoing-reason" name="reason" />
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
