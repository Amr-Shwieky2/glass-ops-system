"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Pencil } from "lucide-react";
import { updateWorkTypeAction, type ActionState } from "@/server/lookups/actions";
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

export interface WorkTypeRow {
  id: string;
  key: string;
  labelEn: string;
  labelAr: string;
  defaultUnit: string;
  sortOrder: number;
  isActive: boolean;
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

/** key is not editable — see createWorkTypeAction's doc comment. */
export function EditWorkTypeDialog({ workType }: { workType: WorkTypeRow }) {
  const [open, setOpen] = React.useState(false);
  const action = updateWorkTypeAction.bind(null, workType.id);
  const [state, formAction] = useActionState(action, initialState);

  useCloseOnSuccess(state, setOpen);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="icon" variant="ghost" className="size-8" aria-label="تعديل نوع العمل">
          <Pencil className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>تعديل نوع العمل</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label>المفتاح</Label>
            <Input dir="ltr" value={workType.key} disabled readOnly />
            <p className="text-xs text-muted-foreground">غير قابل للتعديل.</p>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="labelEn">التسمية بالإنجليزية *</Label>
              <Input id="labelEn" name="labelEn" dir="ltr" defaultValue={workType.labelEn} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="labelAr">التسمية بالعربية *</Label>
              <Input id="labelAr" name="labelAr" defaultValue={workType.labelAr} required />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="defaultUnit">الوحدة الافتراضية *</Label>
              <Input
                id="defaultUnit"
                name="defaultUnit"
                dir="ltr"
                defaultValue={workType.defaultUnit}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sortOrder">ترتيب العرض *</Label>
              <Input
                id="sortOrder"
                name="sortOrder"
                type="text"
                inputMode="numeric"
                dir="ltr"
                defaultValue={workType.sortOrder}
                required
              />
            </div>
          </div>

          <input type="hidden" name="isActive" value={workType.isActive ? "true" : "false"} />

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
