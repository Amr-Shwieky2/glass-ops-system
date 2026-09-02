"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { createRepairAction, type ActionState } from "@/server/repairs/actions";
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

const initialState: ActionState = {};

const NONE = "none";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "جارٍ الحفظ..." : "تسجيل"}
    </Button>
  );
}

export function CreateRepairDialog({
  jobId,
  assignableUsers,
}: {
  jobId: string;
  assignableUsers: { id: string; name: string }[];
}) {
  const [open, setOpen] = React.useState(false);
  const [responsibleUserId, setResponsibleUserId] = React.useState(NONE);
  const action = createRepairAction.bind(null, jobId);
  const [state, formAction] = useActionState(action, initialState);

  useCloseOnSuccess(state, setOpen);

  const [prevState, setPrevState] = React.useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state.success) toast.success("تم تسجيل الإصلاح.");
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setResponsibleUserId(NONE);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus className="size-4" />
          الإبلاغ عن مشكلة
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>الإبلاغ عن مشكلة / إصلاح</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="problemDescription">وصف المشكلة *</Label>
            <Textarea id="problemDescription" name="problemDescription" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="responsibleUserId">المسؤول (اختياري)</Label>
            <Select value={responsibleUserId} onValueChange={setResponsibleUserId}>
              <SelectTrigger id="responsibleUserId">
                <SelectValue placeholder="بدون مسؤول محدد" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>بدون مسؤول محدد</SelectItem>
                {assignableUsers.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {responsibleUserId !== NONE && (
              <input type="hidden" name="responsibleUserId" value={responsibleUserId} />
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="scheduledDate">موعد مجدول (اختياري)</Label>
            <Input id="scheduledDate" name="scheduledDate" type="date" dir="ltr" />
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
