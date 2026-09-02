"use client";

import * as React from "react";
import { useTransition } from "react";
import { toast } from "sonner";
import { CheckCircle2, XCircle } from "lucide-react";
import { decideJobCostAction, type ActionState } from "@/server/costs/actions";
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
import { formatILS } from "@/server/money";

const initialState: ActionState = {};

export function CostDecisionButtons({
  costId,
  amount,
}: {
  costId: string;
  amount: string;
}) {
  const [isPending, startTransition] = useTransition();

  function decide(decision: "approve" | "reject") {
    startTransition(async () => {
      const formData = new FormData();
      formData.set("decision", decision);
      const result = await decideJobCostAction(costId, initialState, formData);
      if (result.error) toast.error(result.error);
      else toast.success(decision === "approve" ? "تم اعتماد التكلفة." : "تم رفض التكلفة.");
    });
  }

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
            <AlertDialogTitle>اعتماد التكلفة</AlertDialogTitle>
            <AlertDialogDescription>
              سيتم اعتماد تكلفة بمبلغ {formatILS(amount)} وإضافتها إلى التكلفة الفعلية للمهمة.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction disabled={isPending} onClick={() => decide("approve")}>
              اعتماد
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button size="sm" variant="outline" className="text-destructive hover:text-destructive">
            <XCircle className="size-4" />
            رفض
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>رفض التكلفة</AlertDialogTitle>
            <AlertDialogDescription>
              سيتم رفض تكلفة بمبلغ {formatILS(amount)}. هل تريد المتابعة؟
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>تراجع</AlertDialogCancel>
            <AlertDialogAction disabled={isPending} onClick={() => decide("reject")}>
              تأكيد الرفض
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
