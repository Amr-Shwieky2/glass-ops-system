"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { createCustomer, updateCustomer, type CustomerFormState } from "@/server/customers/actions";
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

export interface CustomerDialogInitialValues {
  id: string;
  name: string;
  phone: string;
  nationalId: string | null;
  address: string | null;
  googleMapsUrl: string | null;
  notes: string | null;
}

interface CustomerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customer?: CustomerDialogInitialValues;
  onSuccess?: (customerId: string) => void;
}

const initialState: CustomerFormState = {};

function SubmitButton({ isEdit }: { isEdit: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "جارٍ الحفظ..." : isEdit ? "حفظ التعديلات" : "إضافة العميل"}
    </Button>
  );
}

export function CustomerDialog({
  open,
  onOpenChange,
  customer,
  onSuccess,
}: CustomerDialogProps) {
  const isEdit = Boolean(customer);
  const action = isEdit
    ? updateCustomer.bind(null, customer!.id)
    : createCustomer;
  const [state, formAction] = useActionState(action, initialState);

  React.useEffect(() => {
    if (state.success && state.customerId) {
      onSuccess?.(state.customerId);
      onOpenChange(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "تعديل بيانات العميل" : "عميل جديد"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "حدّث بيانات العميل ثم احفظ التعديلات."
              : "أدخل بيانات العميل الجديد."}
          </DialogDescription>
        </DialogHeader>
        <form action={formAction} className="space-y-4" noValidate>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="name">الاسم *</Label>
              <Input
                id="name"
                name="name"
                required
                defaultValue={customer?.name}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">رقم الهاتف *</Label>
              <Input
                id="phone"
                name="phone"
                type="tel"
                dir="ltr"
                required
                defaultValue={customer?.phone}
              />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="nationalId">رقم الهوية</Label>
              <Input
                id="nationalId"
                name="nationalId"
                dir="ltr"
                defaultValue={customer?.nationalId ?? ""}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="googleMapsUrl">رابط خرائط جوجل</Label>
              <Input
                id="googleMapsUrl"
                name="googleMapsUrl"
                dir="ltr"
                placeholder="https://maps.google.com/..."
                defaultValue={customer?.googleMapsUrl ?? ""}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="address">العنوان</Label>
            <Input id="address" name="address" defaultValue={customer?.address ?? ""} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="notes">ملاحظات</Label>
            <Textarea id="notes" name="notes" defaultValue={customer?.notes ?? ""} />
          </div>

          {state.error && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {state.error}
            </p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              إلغاء
            </Button>
            <SubmitButton isEdit={isEdit} />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
