"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { recordMaintenanceCostAction, type ActionState } from "@/server/vehicles/maintenance-actions";
import { useCloseOnSuccess } from "@/lib/use-close-on-success";
import { getTodayDateString } from "@/lib/company-day";
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

const CATEGORY_OPTIONS = [
  { value: "maintenance", label: "صيانة" },
  { value: "insurance", label: "تأمين" },
  { value: "registration", label: "ترخيص" },
  { value: "tires", label: "إطارات" },
  { value: "other", label: "أخرى" },
];

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "جارٍ الحفظ..." : "تسجيل التكلفة"}
    </Button>
  );
}

/** MANAGE_VEHICLES-only — a non-fuel operating cost (Sprint 7, S7.6):
 * maintenance, insurance, registration, tires, or other. */
export function AddMaintenanceCostDialog({ vehicleId }: { vehicleId: string }) {
  const [open, setOpen] = React.useState(false);
  const [state, formAction] = useActionState(recordMaintenanceCostAction, initialState);
  const today = getTodayDateString();

  useCloseOnSuccess(state, setOpen);

  const [prevState, setPrevState] = React.useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state.success) toast.success("تم تسجيل التكلفة.");
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus className="size-4" />
          تكلفة تشغيل
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>تسجيل تكلفة تشغيل</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="space-y-4" noValidate>
          <input type="hidden" name="vehicleId" value={vehicleId} />
          <div className="space-y-2">
            <Label htmlFor="maintenance-category">النوع *</Label>
            <Select name="category" required defaultValue="maintenance">
              <SelectTrigger id="maintenance-category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORY_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="maintenance-amount">المبلغ *</Label>
              <Input
                id="maintenance-amount"
                name="amount"
                type="text"
                inputMode="decimal"
                dir="ltr"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="maintenance-date">التاريخ</Label>
              <Input id="maintenance-date" name="incurredAt" type="date" defaultValue={today} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="maintenance-description">الوصف *</Label>
            <Textarea id="maintenance-description" name="description" required />
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
