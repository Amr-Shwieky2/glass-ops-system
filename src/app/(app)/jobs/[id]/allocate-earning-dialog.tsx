"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import type { CompensationRuleOption } from "@/server/compensation/queries";
import { allocateInstallationEarning, type ActionState } from "@/server/compensation/actions";
import { useCloseOnSuccess } from "@/lib/use-close-on-success";
import { formatILS } from "@/server/money";
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
import { cn } from "@/lib/utils";

const initialState: ActionState = {};
const NONE = "none";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "جارٍ الحفظ..." : "تخصيص المستحق"}
    </Button>
  );
}

export function AllocateEarningDialog({
  jobId,
  assignableUsers,
  compensationRules,
  jobItems,
}: {
  jobId: string;
  assignableUsers: { id: string; name: string }[];
  compensationRules: CompensationRuleOption[];
  jobItems: { id: string; description: string | null; workTypeLabelAr: string | null }[];
}) {
  const [open, setOpen] = React.useState(false);
  const [isCustom, setIsCustom] = React.useState(false);
  const [jobItemId, setJobItemId] = React.useState(NONE);
  const [ruleId, setRuleId] = React.useState(NONE);
  const [quantity, setQuantity] = React.useState("1");

  const action = allocateInstallationEarning.bind(null, jobId);
  const [state, formAction] = useActionState(action, initialState);

  useCloseOnSuccess(state, setOpen);

  const [prevState, setPrevState] = React.useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state.success) toast.success("تم تخصيص المستحق.");
  }

  const selectedRule = compensationRules.find((r) => r.id === ruleId) ?? null;
  const parsedQuantity = Number(quantity);
  const previewAmount =
    selectedRule && Number.isFinite(parsedQuantity) && parsedQuantity > 0
      ? formatILS(Number(selectedRule.amount) * parsedQuantity)
      : null;

  function resetLocalState() {
    setIsCustom(false);
    setJobItemId(NONE);
    setRuleId(NONE);
    setQuantity("1");
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) resetLocalState();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus className="size-4" />
          تخصيص تعويض تركيب
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>تخصيص تعويض تركيب</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="space-y-4" noValidate>
          <input type="hidden" name="isCustom" value={isCustom ? "true" : "false"} />

          <div className="space-y-2">
            <Label htmlFor="userId">الفني *</Label>
            <Select name="userId" required>
              <SelectTrigger id="userId">
                <SelectValue placeholder="اختر فنياً" />
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

          <div className="space-y-2">
            <Label htmlFor="jobItemId">بند العمل (اختياري)</Label>
            <Select value={jobItemId} onValueChange={setJobItemId}>
              <SelectTrigger id="jobItemId">
                <SelectValue placeholder="بدون بند محدد" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>بدون بند محدد</SelectItem>
                {jobItems.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.workTypeLabelAr ?? item.description ?? "بند عمل"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {jobItemId !== NONE && <input type="hidden" name="jobItemId" value={jobItemId} />}
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setIsCustom(false)}
              className={cn(
                "rounded-md border px-3 py-1.5 text-sm font-medium",
                !isCustom
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-input text-muted-foreground",
              )}
            >
              قاعدة محددة
            </button>
            <button
              type="button"
              onClick={() => setIsCustom(true)}
              className={cn(
                "rounded-md border px-3 py-1.5 text-sm font-medium",
                isCustom
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-input text-muted-foreground",
              )}
            >
              مبلغ مخصص
            </button>
          </div>

          {/* isCustom's two branches both put an <Input> as their second
              field, in the same tree position — one controlled (value=
              {quantity}), the other uncontrolled (no value prop at all).
              Without distinct keys React reconciles them as the SAME DOM
              node across the toggle instead of unmounting/remounting it,
              which flips that node from controlled to uncontrolled (or
              back) and trips React's "changing a controlled input to be
              uncontrolled" warning. The keys below force a clean
              unmount/remount on every isCustom toggle instead. */}
          {!isCustom ? (
            <React.Fragment key="rule-fields">
              <div className="space-y-2">
                <Label htmlFor="compensationRuleId">بند التسعير *</Label>
                <Select name="compensationRuleId" value={ruleId === NONE ? "" : ruleId} onValueChange={setRuleId}>
                  <SelectTrigger id="compensationRuleId">
                    <SelectValue placeholder="اختر بند التسعير" />
                  </SelectTrigger>
                  <SelectContent>
                    {compensationRules.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.label} ({formatILS(r.amount)} / {r.unit})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="quantity">الكمية *</Label>
                <Input
                  id="quantity"
                  name="quantity"
                  type="text"
                  inputMode="decimal"
                  dir="ltr"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  required
                />
              </div>
              {previewAmount && (
                <p className="text-sm text-muted-foreground">المبلغ المتوقع: {previewAmount}</p>
              )}
            </React.Fragment>
          ) : (
            <React.Fragment key="custom-fields">
              <div className="space-y-2">
                <Label htmlFor="customDescription">وصف المستحق *</Label>
                <Textarea id="customDescription" name="customDescription" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="customAmount">المبلغ *</Label>
                <Input
                  id="customAmount"
                  name="customAmount"
                  type="text"
                  inputMode="decimal"
                  dir="ltr"
                  required
                />
              </div>
            </React.Fragment>
          )}

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
