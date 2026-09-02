"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Plus } from "lucide-react";
import { createMeasurement, type ActionState } from "@/server/jobs/actions";
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

const initialState: ActionState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "جارٍ الحفظ..." : "حفظ القياس"}
    </Button>
  );
}

function nowForDatetimeLocal(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export function AddMeasurementDialog({
  jobId,
  assignableUsers,
}: {
  jobId: string;
  assignableUsers: { id: string; name: string }[];
}) {
  const [open, setOpen] = React.useState(false);
  const action = createMeasurement.bind(null, jobId);
  const [state, formAction] = useActionState(action, initialState);

  useCloseOnSuccess(state, setOpen);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus className="size-4" />
          إضافة قياس
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>تسجيل قياس</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="measuredAt">تاريخ ووقت القياس *</Label>
            <Input
              id="measuredAt"
              name="measuredAt"
              type="datetime-local"
              required
              defaultValue={nowForDatetimeLocal()}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="details">تفاصيل القياس</Label>
            <Textarea id="details" name="details" placeholder="الأبعاد، الملاحظات..." />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="photosTaken" name="photosTaken" />
            <Label htmlFor="photosTaken" className="font-normal">
              تم التقاط صور
            </Label>
          </div>
          <div className="space-y-2">
            <Label htmlFor="pricingResponsibleUserId">المسؤول عن التسعير</Label>
            <Select name="pricingResponsibleUserId">
              <SelectTrigger id="pricingResponsibleUserId">
                <SelectValue placeholder="اختر مسؤول التسعير" />
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
