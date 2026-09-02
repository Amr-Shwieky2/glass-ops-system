"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Plus } from "lucide-react";
import { createJobStatusAction, type ActionState } from "@/server/lookups/actions";
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
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";

const initialState: ActionState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "جارٍ الحفظ..." : "إضافة حالة"}
    </Button>
  );
}

export function AddJobStatusDialog() {
  const [open, setOpen] = React.useState(false);
  const [isTerminal, setIsTerminal] = React.useState(false);
  const [state, formAction] = useActionState(createJobStatusAction, initialState);

  useCloseOnSuccess(state, setOpen);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setIsTerminal(false);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="size-4" />
          إضافة حالة
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>إضافة حالة مهمة جديدة</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="key">المفتاح *</Label>
            <Input id="key" name="key" dir="ltr" placeholder="measurement_scheduled" required />
            <p className="text-xs text-muted-foreground">
              معرّف ثابت بالإنجليزية (أحرف صغيرة وأرقام وشرطة سفلية فقط) يستخدمه النظام داخلياً
              للتعرف على الحالة — لا يمكن تعديله بعد الإنشاء، لذا تأكد منه الآن.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="labelEn">التسمية بالإنجليزية *</Label>
              <Input id="labelEn" name="labelEn" dir="ltr" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="labelAr">التسمية بالعربية *</Label>
              <Input id="labelAr" name="labelAr" required />
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
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="color">اللون (اختياري)</Label>
              <Input id="color" name="color" dir="ltr" placeholder="#2563eb" />
            </div>
          </div>
          <div className="flex items-center justify-between gap-2 rounded-md border p-3">
            <div>
              <Label htmlFor="isTerminal" className="font-normal">
                حالة نهائية
              </Label>
              <p className="text-xs text-muted-foreground">
                لا تنتقل المهمة بعدها إلى أي حالة أخرى. لا يمكن تعديل هذا الخيار لاحقاً.
              </p>
            </div>
            <Switch id="isTerminal" checked={isTerminal} onCheckedChange={setIsTerminal} />
            <input type="hidden" name="isTerminal" value={isTerminal ? "true" : "false"} />
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
