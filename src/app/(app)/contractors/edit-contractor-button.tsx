"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ContractorDialog, type ContractorDialogInitialValues } from "./contractor-dialog";

export function EditContractorButton({
  contractor,
}: {
  contractor: ContractorDialogInitialValues;
}) {
  const [open, setOpen] = React.useState(false);
  const router = useRouter();

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Pencil className="size-4" />
        تعديل
      </Button>
      <ContractorDialog
        open={open}
        onOpenChange={setOpen}
        contractor={contractor}
        onSuccess={() => {
          toast.success("تم تحديث بيانات المقاول.");
          router.refresh();
        }}
      />
    </>
  );
}
