"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { Gift, TriangleAlert } from "lucide-react";
import type { BonusRuleOption, PenaltyRuleOption } from "@/server/compensation/queries";
import {
  recordBonus,
  recordPenalty,
  type ActionState,
} from "@/server/compensation/actions";
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

function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? pendingLabel : label}
    </Button>
  );
}

export function BonusDialog({
  jobId,
  assignableUsers,
  bonusRules,
}: {
  jobId: string;
  assignableUsers: { id: string; name: string }[];
  bonusRules: BonusRuleOption[];
}) {
  const [open, setOpen] = React.useState(false);
  const [ruleId, setRuleId] = React.useState(NONE);

  const boundAction = React.useCallback(
    async (prevState: ActionState, formData: FormData): Promise<ActionState> => {
      const userId = formData.get("userId");
      if (typeof userId !== "string" || !userId) return { error: "الفني مطلوب." };
      return recordBonus(userId, prevState, formData);
    },
    [],
  );
  const [state, formAction] = useActionState(boundAction, initialState);

  useCloseOnSuccess(state, setOpen);

  const [prevState, setPrevState] = React.useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state.success) toast.success("تم تسجيل المكافأة.");
  }

  const selectedRule = bonusRules.find((r) => r.id === ruleId) ?? null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setRuleId(NONE);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Gift className="size-4" />
          مكافأة
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>تسجيل مكافأة</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="space-y-4" noValidate>
          <input type="hidden" name="jobId" value={jobId} />
          <div className="space-y-2">
            <Label htmlFor="bonus-userId">الفني *</Label>
            <Select name="userId" required>
              <SelectTrigger id="bonus-userId">
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
            <Label htmlFor="bonusRuleId">نوع المكافأة (اختياري)</Label>
            <Select value={ruleId} onValueChange={setRuleId}>
              <SelectTrigger id="bonusRuleId">
                <SelectValue placeholder="بدون قاعدة محددة" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>بدون قاعدة محددة</SelectItem>
                {bonusRules.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {ruleId !== NONE && <input type="hidden" name="bonusRuleId" value={ruleId} />}
          </div>
          {ruleId === NONE && (
            <div className="space-y-2">
              <Label htmlFor="bonus-customDescription">الوصف *</Label>
              <Textarea id="bonus-customDescription" name="customDescription" required />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="bonus-amount">
              المبلغ {selectedRule ? "(اختياري — افتراضي من القاعدة)" : "*"}
            </Label>
            <Input
              id="bonus-amount"
              name="amount"
              type="text"
              inputMode="decimal"
              dir="ltr"
              placeholder={selectedRule ? selectedRule.defaultAmount : undefined}
              required={!selectedRule}
            />
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
            <SubmitButton label="تسجيل المكافأة" pendingLabel="جارٍ الحفظ..." />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function PenaltyDialog({
  jobId,
  assignableUsers,
  penaltyRules,
}: {
  jobId: string;
  assignableUsers: { id: string; name: string }[];
  penaltyRules: PenaltyRuleOption[];
}) {
  const [open, setOpen] = React.useState(false);
  const [ruleId, setRuleId] = React.useState(NONE);

  const boundAction = React.useCallback(
    async (prevState: ActionState, formData: FormData): Promise<ActionState> => {
      const userId = formData.get("userId");
      if (typeof userId !== "string" || !userId) return { error: "الفني مطلوب." };
      return recordPenalty(userId, prevState, formData);
    },
    [],
  );
  const [state, formAction] = useActionState(boundAction, initialState);

  useCloseOnSuccess(state, setOpen);

  const [prevState, setPrevState] = React.useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state.success) toast.success("تم تسجيل المخالفة.");
  }

  const selectedRule = penaltyRules.find((r) => r.id === ruleId) ?? null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setRuleId(NONE);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="text-destructive hover:text-destructive">
          <TriangleAlert className="size-4" />
          غرامة
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>تسجيل مخالفة</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="space-y-4" noValidate>
          <input type="hidden" name="jobId" value={jobId} />
          <div className="space-y-2">
            <Label htmlFor="penalty-userId">الفني *</Label>
            <Select name="userId" required>
              <SelectTrigger id="penalty-userId">
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
            <Label htmlFor="penaltyRuleId">نوع المخالفة (اختياري)</Label>
            <Select value={ruleId} onValueChange={setRuleId}>
              <SelectTrigger id="penaltyRuleId">
                <SelectValue placeholder="بدون قاعدة محددة" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>بدون قاعدة محددة</SelectItem>
                {penaltyRules.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {ruleId !== NONE && <input type="hidden" name="penaltyRuleId" value={ruleId} />}
          </div>
          {ruleId === NONE && (
            <div className="space-y-2">
              <Label htmlFor="penalty-customDescription">الوصف *</Label>
              <Textarea id="penalty-customDescription" name="customDescription" required />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="penalty-reason">سبب المخالفة *</Label>
            <Textarea id="penalty-reason" name="reason" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="penalty-amount">
              المبلغ {selectedRule ? "(اختياري — افتراضي من القاعدة)" : "*"}
            </Label>
            <Input
              id="penalty-amount"
              name="amount"
              type="text"
              inputMode="decimal"
              dir="ltr"
              placeholder={selectedRule ? selectedRule.defaultAmount : undefined}
              required={!selectedRule}
            />
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
            <SubmitButton label="تسجيل المخالفة" pendingLabel="جارٍ الحفظ..." />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
