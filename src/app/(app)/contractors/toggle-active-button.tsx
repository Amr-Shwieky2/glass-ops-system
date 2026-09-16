"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { setContractorActiveAction } from "@/server/contractors/actions";
import { Button } from "@/components/ui/button";

export function ToggleActiveButton({
  contractorId,
  isActive,
}: {
  contractorId: string;
  isActive: boolean;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      size="sm"
      variant="outline"
      disabled={isPending}
      onClick={() => {
        startTransition(async () => {
          const result = await setContractorActiveAction(contractorId, !isActive);
          if (result.error) toast.error(result.error);
          else toast.success(isActive ? "تم إلغاء تفعيل المقاول." : "تم تفعيل المقاول.");
        });
      }}
    >
      {isActive ? "إلغاء التفعيل" : "تفعيل"}
    </Button>
  );
}
