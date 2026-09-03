"use client";

import * as React from "react";
import { useActionState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { CheckCircle2, XCircle } from "lucide-react";
import { decideFieldExpenseAction, type ActionState } from "@/server/finance/expense-actions";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useCloseOnSuccess } from "@/lib/use-close-on-success";
import { formatILS } from "@/server/money";

const initialState: ActionState = {};

function RejectSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="destructive" disabled={pending}>
      {pending ? "جارٍ الحفظ..." : "تأكيد الرفض"}
    </Button>
  );
}

function RejectFieldExpenseDialog({ reportId }: { reportId: string }) {
  const [open, setOpen] = React.useState(false);
  const action = decideFieldExpenseAction.bind(null, reportId);
  const [state, formAction] = useActionState(action, initialState);

  useCloseOnSuccess(state, setOpen);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="text-destructive hover:text-destructive">
          <XCircle className="size-4" />
          رفض
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>رفض المصروف الميداني</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="space-y-4" noValidate>
          <input type="hidden" name="decision" value="reject" />
          <div className="space-y-2">
            <Label htmlFor="rejectionReason">سبب الرفض *</Label>
            <Textarea id="rejectionReason" name="rejectionReason" required />
          </div>
          {state.error && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {state.error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              تراجع
            </Button>
            <RejectSubmitButton />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** MANAGE_TECHNICIAN_PAYMENTS-only — decides a pending field-expense
 * report (src/server/finance/expense-actions.ts). */
export function FieldExpenseDecisionButtons({
  reportId,
  amount,
}: {
  reportId: string;
  amount: string;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button size="sm">
            <CheckCircle2 className="size-4" />
            اعتماد
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>اعتماد المصروف الميداني</AlertDialogTitle>
            <AlertDialogDescription>
              سيتم اعتماد مصروف بمبلغ {formatILS(amount)} وخصمه من صندوق النقد فوراً.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              disabled={isPending}
              onClick={() => {
                startTransition(async () => {
                  const formData = new FormData();
                  formData.set("decision", "approve");
                  const result = await decideFieldExpenseAction(reportId, initialState, formData);
                  if (result.error) toast.error(result.error);
                  else toast.success("تم اعتماد المصروف.");
                });
              }}
            >
              اعتماد
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <RejectFieldExpenseDialog reportId={reportId} />
    </div>
  );
}
