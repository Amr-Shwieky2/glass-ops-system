"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Plus } from "lucide-react";
import { addJobItem, type ActionState } from "@/server/jobs/actions";
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
      {pending ? "جارٍ الحفظ..." : "إضافة البند"}
    </Button>
  );
}

export function AddJobItemDialog({
  jobId,
  workTypes,
}: {
  jobId: string;
  workTypes: { id: string; labelAr: string; defaultUnit: string }[];
}) {
  const [open, setOpen] = React.useState(false);
  const action = addJobItem.bind(null, jobId);
  const [state, formAction] = useActionState(action, initialState);

  useCloseOnSuccess(state, setOpen);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus className="size-4" />
          إضافة بند
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>بند عمل جديد</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="workTypeId">نوع العمل</Label>
            <Select name="workTypeId">
              <SelectTrigger id="workTypeId">
                <SelectValue placeholder="اختر نوع العمل" />
              </SelectTrigger>
              <SelectContent>
                {workTypes.map((wt) => (
                  <SelectItem key={wt.id} value={wt.id}>
                    {wt.labelAr}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">الوصف</Label>
            <Input id="description" name="description" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="quantity">الكمية</Label>
              <Input id="quantity" name="quantity" type="text" inputMode="decimal" defaultValue="1" dir="ltr" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="unit">الوحدة</Label>
              <Input id="unit" name="unit" placeholder="متر / قطعة" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="salePrice">سعر البيع</Label>
              <Input id="salePrice" name="salePrice" type="text" inputMode="decimal" dir="ltr" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="expectedCost">التكلفة المتوقعة</Label>
              <Input id="expectedCost" name="expectedCost" type="text" inputMode="decimal" dir="ltr" />
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
