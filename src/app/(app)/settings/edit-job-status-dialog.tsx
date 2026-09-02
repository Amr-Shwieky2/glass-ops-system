"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Pencil } from "lucide-react";
import { updateJobStatusAction, type ActionState } from "@/server/lookups/actions";
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

export interface JobStatusRow {
  id: string;
  key: string;
  labelEn: string;
  labelAr: string;
  sortOrder: number;
  isTerminal: boolean;
  isActive: boolean;
  color: string | null;
}

const initialState: ActionState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "جارٍ الحفظ..." : "حفظ التعديلات"}
    </Button>
  );
}

/**
 * Edits labelEn/labelAr/sortOrder/color only — key and isTerminal are not
 * in this form at all, matching updateJobStatusAction's deliberate
 * restriction (see its doc comment: key is matched by literal elsewhere in
 * the codebase, isTerminal underpins forward-only status ordering).
 * isActive itself is toggled from the table row (ActiveToggle), not here.
 */
export function EditJobStatusDialog({ status }: { status: JobStatusRow }) {
  const [open, setOpen] = React.useState(false);
  const action = updateJobStatusAction.bind(null, status.id);
  const [state, formAction] = useActionState(action, initialState);

  useCloseOnSuccess(state, setOpen);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="icon" variant="ghost" className="size-8" aria-label="تعديل الحالة">
          <Pencil className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>تعديل حالة المهمة</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label>المفتاح</Label>
            <Input dir="ltr" value={status.key} disabled readOnly />
            <p className="text-xs text-muted-foreground">
              غير قابل للتعديل — يستخدمه النظام داخلياً للتعرف على هذه الحالة.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="labelEn">التسمية بالإنجليزية *</Label>
              <Input id="labelEn" name="labelEn" dir="ltr" defaultValue={status.labelEn} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="labelAr">التسمية بالعربية *</Label>
              <Input id="labelAr" name="labelAr" defaultValue={status.labelAr} required />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="sortOrder">ترتيب العرض *</Label>
              <Input
                id="sortOrder"
                name="sortOrder"
                type="text"
                inputMode="numeric"
                dir="ltr"
                defaultValue={status.sortOrder}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="color">اللون (اختياري)</Label>
              <Input id="color" name="color" dir="ltr" defaultValue={status.color ?? ""} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>حالة نهائية</Label>
            <p className="text-xs text-muted-foreground">
              {status.isTerminal ? "نعم" : "لا"} — غير قابل للتعديل بعد الإنشاء.
            </p>
          </div>

          {/* isActive is unchanged by this form — sent as-is so the
              backend's in-use guard only ever triggers from the table's
              own ActiveToggle, never as a side effect of an unrelated edit. */}
          <input type="hidden" name="isActive" value={status.isActive ? "true" : "false"} />

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
