"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Plus } from "lucide-react";
import { createWorkTypeAction, type ActionState } from "@/server/lookups/actions";
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

const initialState: ActionState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "جارٍ الحفظ..." : "إضافة نوع عمل"}
    </Button>
  );
}

export function AddWorkTypeDialog() {
  const [open, setOpen] = React.useState(false);
  const [state, formAction] = useActionState(createWorkTypeAction, initialState);

  useCloseOnSuccess(state, setOpen);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="size-4" />
          إضافة نوع عمل
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>إضافة نوع عمل جديد</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="key">المفتاح *</Label>
            <Input id="key" name="key" dir="ltr" placeholder="shower_enclosure" required />
            <p className="text-xs text-muted-foreground">
              معرّف ثابت بالإنجليزية — لا يمكن تعديله بعد الإنشاء.
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
              <Label htmlFor="defaultUnit">الوحدة الافتراضية *</Label>
              <Input id="defaultUnit" name="defaultUnit" dir="ltr" placeholder="meter" required />
            </div>
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
