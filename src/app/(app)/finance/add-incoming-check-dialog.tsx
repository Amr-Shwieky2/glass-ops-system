"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { createIncomingCheckAction, type ActionState } from "@/server/checks/actions";
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
import { CustomerCombobox } from "@/app/(app)/jobs/customer-combobox";
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

export function AddIncomingCheckDialog() {
  const [open, setOpen] = React.useState(false);
  const [state, formAction] = useActionState(createIncomingCheckAction, initialState);

  useCloseOnSuccess(state, setOpen);

  const [prevState, setPrevState] = React.useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state.success) toast.success("تم تسجيل الشيك الوارد.");
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus className="size-4" />
          شيك وارد
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>تسجيل شيك وارد من عميل</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label>العميل *</Label>
            <CustomerCombobox name="customerId" />
          </div>
          <div className="space-y-2">
            <Label>المهمة (اختياري)</Label>
            <JobCombobox name="jobId" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="incoming-amount">المبلغ *</Label>
              <Input
                id="incoming-amount"
                name="amount"
                type="text"
                inputMode="decimal"
                dir="ltr"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="incoming-due-date">تاريخ الاستحقاق *</Label>
              <Input id="incoming-due-date" name="dueDate" type="date" required />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="incoming-check-number">رقم الشيك</Label>
              <Input id="incoming-check-number" name="checkNumber" dir="ltr" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="incoming-bank">البنك</Label>
              <Input id="incoming-bank" name="bank" />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="incoming-notes">ملاحظات (اختياري)</Label>
            <Textarea id="incoming-notes" name="notes" />
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
