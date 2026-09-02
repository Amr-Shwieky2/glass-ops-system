"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Plus } from "lucide-react";
import { createVehicleAction, type ActionState } from "@/server/vehicles/actions";
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
    <Button type="submit" disabled={pending}>
      {pending ? "جارٍ الحفظ..." : "إضافة المركبة"}
    </Button>
  );
}

export function AddVehicleDialog() {
  const [open, setOpen] = React.useState(false);
  const [state, formAction] = useActionState(createVehicleAction, initialState);

  useCloseOnSuccess(state, setOpen);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="size-4" />
          إضافة مركبة
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>إضافة مركبة</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="name">اسم المركبة *</Label>
            <Input id="name" name="name" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="plateNumber">رقم اللوحة *</Label>
            <Input id="plateNumber" name="plateNumber" dir="ltr" required />
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
            <Label htmlFor="estimatedValue">القيمة التقديرية (اختياري)</Label>
            <Input
              id="estimatedValue"
              name="estimatedValue"
              type="text"
              inputMode="decimal"
              dir="ltr"
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
