"use client";

import * as React from "react";
import { useTransition } from "react";
import { toast } from "sonner";
import { CheckCircle2 } from "lucide-react";
import { closeJobAction, type ActionState } from "@/server/jobs/close";
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
import { Button } from "@/components/ui/button";

const initialState: ActionState = {};

/**
 * closeJobAction's validation can fail for reasons the user needs to see
 * (an open repair, an unset sale price, an outstanding balance) — so this
 * is a confirm-then-surface-the-result pattern (mirrors
 * confirm-remove-button.tsx / cost-decision-buttons.tsx), not a plain
 * AlertDialog that assumes success and just closes.
 */
export function CloseJobButton({ jobId }: { jobId: string }) {
  const [isPending, startTransition] = useTransition();

  function handleConfirm() {
    startTransition(async () => {
      const result = await closeJobAction(jobId, initialState, new FormData());
      if (result.error) toast.error(result.error);
      else toast.success("تم إغلاق المهمة.");
    });
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline">
          <CheckCircle2 className="size-4" />
          إغلاق المهمة
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>إغلاق المهمة</AlertDialogTitle>
          <AlertDialogDescription>
            سيتم وضع المهمة في حالة &quot;مكتملة&quot;. يشترط ذلك عدم وجود طلبات إصلاح مفتوحة،
            وتحديد السعر الإجمالي، وتحصيل كامل المبلغ المستحق.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>تراجع</AlertDialogCancel>
          <AlertDialogAction disabled={isPending} onClick={handleConfirm}>
            تأكيد الإغلاق
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
