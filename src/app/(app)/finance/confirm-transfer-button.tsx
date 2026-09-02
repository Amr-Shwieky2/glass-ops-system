"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { CheckCircle2 } from "lucide-react";
import { confirmCashTransfer } from "@/server/finance/transfer-actions";
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

/** MANAGE_TECHNICIAN_PAYMENTS-only — confirms a pending cash handover. */
export function ConfirmTransferButton({
  transferId,
  amount,
  fromUserName,
}: {
  transferId: string;
  amount: string;
  fromUserName: string | null;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="sm">
          <CheckCircle2 className="size-4" />
          تأكيد الاستلام
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>تأكيد استلام النقدية</AlertDialogTitle>
          <AlertDialogDescription>
            سيتم تأكيد استلام مبلغ {formatILS(amount)}
            {fromUserName ? ` من ${fromUserName}` : ""} ونقله إلى صندوق الشركة.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>إلغاء</AlertDialogCancel>
          <AlertDialogAction
            disabled={isPending}
            onClick={() => {
              startTransition(async () => {
                const result = await confirmCashTransfer(transferId, {}, new FormData());
                if (result.error) toast.error(result.error);
                else toast.success("تم تأكيد الاستلام.");
              });
            }}
          >
            تأكيد
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
