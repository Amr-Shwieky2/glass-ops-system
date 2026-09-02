"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Pencil } from "lucide-react";
import { updateVehicleAction, type ActionState } from "@/server/vehicles/actions";
import type { VehicleDetail } from "@/server/vehicles/queries";
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
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { FUEL_TYPE_OPTIONS } from "../fuel-type";

const initialState: ActionState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "جارٍ الحفظ..." : "حفظ التعديلات"}
    </Button>
  );
}

export function EditVehicleDialog({ vehicle }: { vehicle: VehicleDetail }) {
  const [open, setOpen] = React.useState(false);
  const [isActive, setIsActive] = React.useState(vehicle.isActive);
  const action = updateVehicleAction.bind(null, vehicle.id);
  const [state, formAction] = useActionState(action, initialState);

  useCloseOnSuccess(state, setOpen);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setIsActive(vehicle.isActive);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Pencil className="size-4" />
          تعديل
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>تعديل المركبة</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="name">اسم المركبة *</Label>
            <Input id="name" name="name" defaultValue={vehicle.name} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="plateNumber">رقم اللوحة *</Label>
            <Input
              id="plateNumber"
              name="plateNumber"
              dir="ltr"
              defaultValue={vehicle.plateNumber}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="fuelType">نوع الوقود *</Label>
            <Select name="fuelType" required defaultValue={vehicle.fuelType}>
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
            <Label htmlFor="estimatedValue">القيمة التقديرية (اختياري)</Label>
            <Input
              id="estimatedValue"
              name="estimatedValue"
              type="text"
              inputMode="decimal"
              dir="ltr"
              defaultValue={vehicle.estimatedValue ?? ""}
            />
          </div>

          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="isActive" className="font-normal">
              مركبة نشطة
            </Label>
            <Switch id="isActive" checked={isActive} onCheckedChange={setIsActive} />
            <input type="hidden" name="isActive" value={isActive ? "true" : "false"} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">ملاحظات (اختياري)</Label>
            <Textarea id="notes" name="notes" defaultValue={vehicle.notes ?? ""} />
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
