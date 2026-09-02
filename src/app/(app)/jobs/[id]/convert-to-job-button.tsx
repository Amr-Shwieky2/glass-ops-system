"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { ArrowLeftRight } from "lucide-react";
import { convertQuoteToJob } from "@/server/quotes/actions";
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

export function ConvertToJobButton({ jobId, quoteId }: { jobId: string; quoteId: string }) {
  const [isPending, startTransition] = useTransition();

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="sm">
          <ArrowLeftRight className="size-4" />
          تحويل العرض إلى مهمة
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>تحويل العرض الموقّع إلى بنود المهمة</AlertDialogTitle>
          <AlertDialogDescription>
            سيتم استبدال بنود العمل الحالية للمهمة ببنود العرض الموقّع، وتحديث قيمة البيع
            الإجمالية، ونقل المهمة إلى حالة &quot;بانتظار الإنتاج&quot;.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>إلغاء</AlertDialogCancel>
          <AlertDialogAction
            disabled={isPending}
            onClick={() => {
              startTransition(async () => {
                const result = await convertQuoteToJob(jobId, quoteId);
                if (result.error) toast.error(result.error);
                else toast.success("تم تحويل العرض إلى بنود المهمة.");
              });
            }}
          >
            تحويل
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
