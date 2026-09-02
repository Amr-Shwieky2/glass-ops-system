"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { UserCog } from "lucide-react";
import { assignVehicleResponsibility, type ActionState } from "@/server/vehicles/actions";
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

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "جارٍ الحفظ..." : "تعيين"}
    </Button>
  );
}

export function AssignResponsibilityDialog({
  vehicleId,
  assignableUsers,
}: {
  vehicleId: string;
  assignableUsers: { id: string; name: string }[];
}) {
  const [open, setOpen] = React.useState(false);
  const action = assignVehicleResponsibility.bind(null, vehicleId);
  const [state, formAction] = useActionState(action, initialState);

  useCloseOnSuccess(state, setOpen);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <UserCog className="size-4" />
          تغيير المسؤول
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>تغيير المسؤول عن المركبة</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="userId">المسؤول الجديد *</Label>
            <Select name="userId" required>
              <SelectTrigger id="userId">
                <SelectValue placeholder="اختر مستخدماً" />
              </SelectTrigger>
              <SelectContent>
                {assignableUsers.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="startDate">تاريخ البدء (اختياري، الافتراضي اليوم)</Label>
            <Input id="startDate" name="startDate" type="date" dir="ltr" />
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
