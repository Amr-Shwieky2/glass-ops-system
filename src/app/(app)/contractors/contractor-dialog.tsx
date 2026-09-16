"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  createContractorAction,
  updateContractorAction,
  type ActionState,
} from "@/server/contractors/actions";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

export interface ContractorDialogInitialValues {
  id: string;
  name: string;
  phone: string | null;
  serviceType: string | null;
  notes: string | null;
}

interface ContractorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contractor?: ContractorDialogInitialValues;
  onSuccess?: () => void;
}

const initialState: ActionState = {};

function SubmitButton({ isEdit }: { isEdit: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "جارٍ الحفظ..." : isEdit ? "حفظ التعديلات" : "إضافة المقاول"}
    </Button>
  );
}

/** Sprint 7 (R1.31) — create/edit dialog for external contractors, same
 * "one component, action swapped by whether `contractor` is passed" shape
 * as customers/customer-dialog.tsx. */
export function ContractorDialog({
  open,
  onOpenChange,
  contractor,
  onSuccess,
}: ContractorDialogProps) {
  const isEdit = Boolean(contractor);
  const action = isEdit
    ? updateContractorAction.bind(null, contractor!.id)
    : createContractorAction;
  const [state, formAction] = useActionState(action, initialState);

  React.useEffect(() => {
    if (state.success) {
      onSuccess?.();
      onOpenChange(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "تعديل بيانات المقاول" : "مقاول خارجي جديد"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "حدّث بيانات المقاول ثم احفظ التعديلات."
              : "أدخل بيانات المقاول الخارجي الجديد."}
          </DialogDescription>
        </DialogHeader>
        <form action={formAction} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="contractor-name">الاسم *</Label>
            <Input id="contractor-name" name="name" required defaultValue={contractor?.name} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="contractor-phone">الهاتف</Label>
              <Input
                id="contractor-phone"
                name="phone"
                dir="ltr"
                defaultValue={contractor?.phone ?? ""}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contractor-service-type">نوع الخدمة</Label>
              <Input
                id="contractor-service-type"
                name="serviceType"
                placeholder="ألمنيوم / زجاج / أخرى"
                defaultValue={contractor?.serviceType ?? ""}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="contractor-notes">ملاحظات</Label>
            <Textarea id="contractor-notes" name="notes" defaultValue={contractor?.notes ?? ""} />
          </div>

          {state.error && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {state.error}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              إلغاء
            </Button>
            <SubmitButton isEdit={isEdit} />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
