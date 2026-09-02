"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { CalendarPlus } from "lucide-react";
import {
  scheduleAppointmentAction,
  type ScheduleAppointmentState,
} from "@/server/appointments/actions";
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

const initialState: ScheduleAppointmentState = {};

const APPOINTMENT_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "measurement", label: "قياس" },
  { value: "installation", label: "تركيب" },
  { value: "repair", label: "إصلاح" },
  { value: "customer_meeting", label: "لقاء عميل" },
  { value: "other", label: "أخرى" },
];

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "جارٍ الحفظ..." : "جدولة"}
    </Button>
  );
}

export function ScheduleAppointmentDialog({
  jobId,
  assignableUsers,
}: {
  jobId: string;
  assignableUsers: { id: string; name: string }[];
}) {
  const [open, setOpen] = React.useState(false);
  const [selectedUserIds, setSelectedUserIds] = React.useState<string[]>([]);
  const action = scheduleAppointmentAction.bind(null, jobId);
  const [state, formAction] = useActionState(action, initialState);

  // Same "adjust state while rendering" recipe as useCloseOnSuccess
  // (src/lib/use-close-on-success.ts), inlined here because this dialog
  // also needs to fire a toast (and an extra warning toast) as part of
  // the same one-time reaction to a fresh success result.
  const [prevState, setPrevState] = React.useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state.success) {
      setOpen(false);
      toast.success("تم جدولة الموعد بنجاح.");
      if (state.warning) toast.warning(state.warning);
      setSelectedUserIds([]);
    }
  }

  function toggleUser(userId: string, checked: boolean) {
    setSelectedUserIds((prev) =>
      checked ? [...prev, userId] : prev.filter((id) => id !== userId),
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <CalendarPlus className="size-4" />
          جدولة موعد
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>جدولة موعد جديد</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="type">نوع الموعد *</Label>
            <Select name="type" required defaultValue="measurement">
              <SelectTrigger id="type">
                <SelectValue placeholder="اختر نوع الموعد" />
              </SelectTrigger>
              <SelectContent>
                {APPOINTMENT_TYPE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="scheduledStart">البداية *</Label>
              <Input
                id="scheduledStart"
                name="scheduledStart"
                type="datetime-local"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="scheduledEnd">النهاية (اختياري)</Label>
              <Input id="scheduledEnd" name="scheduledEnd" type="datetime-local" />
            </div>
          </div>

          <div className="space-y-2">
            <Label>المسؤولون *</Label>
            <div className="max-h-40 space-y-2 overflow-y-auto rounded-md border p-3">
              {assignableUsers.map((u) => (
                <div key={u.id} className="flex items-center gap-2">
                  <Checkbox
                    id={`assignee-${u.id}`}
                    checked={selectedUserIds.includes(u.id)}
                    onCheckedChange={(checked) => toggleUser(u.id, checked === true)}
                  />
                  <Label htmlFor={`assignee-${u.id}`} className="font-normal">
                    {u.name}
                  </Label>
                </div>
              ))}
            </div>
            {selectedUserIds.map((id) => (
              <input key={id} type="hidden" name="assigneeUserIds" value={id} />
            ))}
          </div>

          <div className="space-y-2">
            <Label htmlFor="location">الموقع (اختياري)</Label>
            <Textarea
              id="location"
              name="location"
              placeholder="يُستخدم عنوان المهمة إن تُرك فارغاً"
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
