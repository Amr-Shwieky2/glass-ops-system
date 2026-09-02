"use client";

import * as React from "react";
import { useActionState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { CheckCircle2, XCircle } from "lucide-react";
import {
  approveFactorySubmission,
  rejectFactorySubmission,
} from "@/server/production/approve";
import type { ActionState } from "@/server/production/actions";
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

function RejectDialog({ jobId, submissionId }: { jobId: string; submissionId: string }) {
  const [open, setOpen] = React.useState(false);
  const action = rejectFactorySubmission.bind(null, jobId, submissionId);
  const [state, formAction] = useActionState(action, initialState);

  useCloseOnSuccess(state, setOpen);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className="text-destructive hover:text-destructive"
          aria-label="رفض سعر المصنع"
        >
          <XCircle className="size-4" />
          رفض
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>رفض سعر المصنع</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="rejectionReason">سبب الرفض *</Label>
            <Textarea
              id="rejectionReason"
              name="rejectionReason"
              required
              placeholder="سيظهر هذا السبب للمصنع عند إعادة إرسال سعر جديد."
            />
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

export function FactoryDecisionButtons({
  jobId,
  submissionId,
  submittedPrice,
}: {
  jobId: string;
  submissionId: string;
  submittedPrice: string;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button size="sm" aria-label="اعتماد سعر المصنع">
            <CheckCircle2 className="size-4" />
            اعتماد السعر
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>اعتماد سعر المصنع</AlertDialogTitle>
            <AlertDialogDescription>
              سيتم تسجيل تكلفة قدرها {formatILS(submittedPrice)} على المهمة، ونقلها إلى حالة
              &quot;جاهز من المصنع&quot;.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              disabled={isPending}
              onClick={() => {
                startTransition(async () => {
                  const result = await approveFactorySubmission(jobId, submissionId);
                  if (result.error) toast.error(result.error);
                  else toast.success("تم اعتماد سعر المصنع وتسجيل التكلفة.");
                });
              }}
            >
              اعتماد
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <RejectDialog jobId={jobId} submissionId={submissionId} />
    </div>
  );
}
