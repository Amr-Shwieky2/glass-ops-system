"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { addFuelAction, type ActionState } from "@/server/fuel/actions";
import { useCloseOnSuccess } from "@/lib/use-close-on-success";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { FUEL_TYPE_OPTIONS } from "./fuel-type";

const initialState: ActionState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} size="lg" className="w-full">
      {pending ? "جارٍ الحفظ..." : "تسجيل الوقود"}
    </Button>
  );
}

/**
 * Add-fuel dialog (section 56) — shared verbatim between the vehicle
 * detail page and My Day's quick action, per the phase brief. The only
 * two fields that feel required for a fast entry are Fuel Type and
 * Amount: Vehicle is pre-filled via `defaultVehicleId` (still a real,
 * changeable Select — a technician near a different vehicle can pick it),
 * and Liters/Mileage/Receipt/Notes are all clearly marked optional.
 * addedByUserId and loggedAt are never collected here — addFuelAction
 * always stamps the current user and "now" server-side.
 */
export function AddFuelDialog({
  vehicles,
  defaultVehicleId,
  trigger,
}: {
  vehicles: { id: string; name: string; plateNumber: string }[];
  defaultVehicleId?: string | null;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const [receiptPhotoTaken, setReceiptPhotoTaken] = React.useState(false);
  const [state, formAction] = useActionState(addFuelAction, initialState);

  useCloseOnSuccess(state, setOpen);

  const [prevState, setPrevState] = React.useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state.success) toast.success("تم تسجيل الوقود.");
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setReceiptPhotoTaken(false);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>إضافة وقود</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="vehicleId">المركبة *</Label>
            <Select name="vehicleId" required defaultValue={defaultVehicleId ?? undefined}>
              <SelectTrigger id="vehicleId">
                <SelectValue placeholder="اختر المركبة" />
              </SelectTrigger>
              <SelectContent>
                {vehicles.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.name} — {v.plateNumber}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="fuelType">نوع الوقود *</Label>
            <Select name="fuelType" required>
              <SelectTrigger id="fuelType">
                <SelectValue placeholder="اختر نوع الوقود" />
              </SelectTrigger>
              <SelectContent>
                {FUEL_TYPE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="amount">المبلغ *</Label>
            <Input
              id="amount"
              name="amount"
              type="text"
              inputMode="decimal"
              dir="ltr"
              autoFocus
              required
              className="text-lg font-medium"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="liters">اللترات (اختياري)</Label>
              <Input id="liters" name="liters" type="text" inputMode="decimal" dir="ltr" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="mileage">قراءة العداد (اختياري)</Label>
              <Input id="mileage" name="mileage" type="text" inputMode="numeric" dir="ltr" />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="receiptPhotoTaken"
              checked={receiptPhotoTaken}
              onCheckedChange={(checked) => setReceiptPhotoTaken(checked === true)}
            />
            <Label htmlFor="receiptPhotoTaken" className="font-normal">
              تم توثيق صورة الإيصال (اختياري)
            </Label>
            <input
              type="hidden"
              name="receiptPhotoTaken"
              value={receiptPhotoTaken ? "true" : "false"}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">ملاحظات (اختياري)</Label>
            <Textarea id="notes" name="notes" />
          </div>

          {state.error && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {state.error}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              إلغاء
            </Button>
            <SubmitButton />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
