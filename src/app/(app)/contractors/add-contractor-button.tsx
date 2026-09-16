"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ContractorDialog } from "./contractor-dialog";

export function AddContractorButton() {
  const [open, setOpen] = React.useState(false);
  const router = useRouter();

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="size-4" />
        مقاول جديد
      </Button>
      <ContractorDialog
        open={open}
        onOpenChange={setOpen}
        onSuccess={() => {
          toast.success("تم إضافة المقاول.");
          router.refresh();
        }}
      />
    </>
  );
}
