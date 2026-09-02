"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { addJobCostAction, type ActionState } from "@/server/costs/actions";
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

const CATEGORY_OPTIONS: { value: string; label: string }[] = [
  { value: "hardware", label: "مواد وتجهيزات" },
  { value: "external_contractor", label: "مقاول خارجي" },
  { value: "aluminum_contractor", label: "مقاول ألمنيوم" },
  { value: "other", label: "أخرى" },
];

const NONE = "none";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "جارٍ الحفظ..." : "إضافة التكلفة"}
    </Button>
  );
}

export function AddCostDialog({
  jobId,
  externalContractors,
}: {
  jobId: string;
  externalContractors: { id: string; name: string }[];
}) {
  const [open, setOpen] = React.useState(false);
  const [contractorId, setContractorId] = React.useState(NONE);
  const action = addJobCostAction.bind(null, jobId);
  const [state, formAction] = useActionState(action, initialState);

  useCloseOnSuccess(state, setOpen);

  const [prevState, setPrevState] = React.useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state.success) toast.success("تم تسجيل التكلفة.");
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setContractorId(NONE);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus className="size-4" />
          إضافة تكلفة
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>تكلفة مهمة جديدة</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="category">الفئة *</Label>
            <Select name="category" required defaultValue="hardware">
              <SelectTrigger id="category">
                <SelectValue placeholder="اختر الفئة" />
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
          <div className="space-y-2">
            <Label htmlFor="amount">المبلغ *</Label>
            <Input id="amount" name="amount" type="text" inputMode="decimal" dir="ltr" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">الوصف *</Label>
            <Textarea id="description" name="description" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="externalContractorId">المقاول الخارجي (اختياري)</Label>
            <Select value={contractorId} onValueChange={setContractorId}>
              <SelectTrigger id="externalContractorId">
                <SelectValue placeholder="بدون مقاول محدد" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>بدون مقاول محدد</SelectItem>
                {externalContractors.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {contractorId !== NONE && (
              <input type="hidden" name="externalContractorId" value={contractorId} />
            )}
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
