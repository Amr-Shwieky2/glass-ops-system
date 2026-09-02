"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CustomerDialog, type CustomerDialogInitialValues } from "./customer-dialog";

export function EditCustomerButton({
  customer,
}: {
  customer: CustomerDialogInitialValues;
}) {
  const [open, setOpen] = React.useState(false);
  const router = useRouter();

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Pencil className="size-4" />
        تعديل
      </Button>
      <CustomerDialog
        open={open}
        onOpenChange={setOpen}
        customer={customer}
        onSuccess={() => router.refresh()}
      />
    </>
  );
}
