"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Pencil } from "lucide-react";
import { updateUserAction, type ActionState } from "@/server/users/actions";
import type { UserDetail } from "@/server/users/queries";
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
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

const initialState: ActionState = {};

const NONE = "none";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "جارٍ الحفظ..." : "حفظ التعديلات"}
    </Button>
  );
}

export function EditUserDialog({
  detail,
  vehicles,
}: {
  detail: UserDetail;
  vehicles: { id: string; name: string }[];
}) {
  const [open, setOpen] = React.useState(false);
  const [defaultVehicleId, setDefaultVehicleId] = React.useState(
    detail.defaultVehicleId ?? NONE,
  );
  const action = updateUserAction.bind(null, detail.id);
  const [state, formAction] = useActionState(action, initialState);

  useCloseOnSuccess(state, setOpen);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setDefaultVehicleId(detail.defaultVehicleId ?? NONE);
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
          <DialogTitle>تعديل بيانات المستخدم</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="name">الاسم *</Label>
            <Input id="name" name="name" defaultValue={detail.name} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="phone">رقم الهاتف *</Label>
            <Input
              id="phone"
              name="phone"
              dir="ltr"
              defaultValue={detail.phone}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">البريد الإلكتروني (اختياري)</Label>
            <Input
              id="email"
              name="email"
              type="email"
              dir="ltr"
              defaultValue={detail.email ?? ""}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="defaultVehicleId">المركبة الافتراضية (اختياري)</Label>
            <Select value={defaultVehicleId} onValueChange={setDefaultVehicleId}>
              <SelectTrigger id="defaultVehicleId">
                <SelectValue placeholder="بدون مركبة محددة" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>بدون مركبة محددة</SelectItem>
                {vehicles.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {defaultVehicleId !== NONE && (
              <input type="hidden" name="defaultVehicleId" value={defaultVehicleId} />
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="dailyWageAmount">الأجر اليومي (اختياري)</Label>
            <Input
              id="dailyWageAmount"
              name="dailyWageAmount"
              type="text"
              inputMode="decimal"
              dir="ltr"
              defaultValue={detail.dailyWageAmount ?? ""}
            />
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
