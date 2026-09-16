"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { Car, Gift, AlertTriangle, CalendarClock, Clock, Scale } from "lucide-react";
import {
  recordVehicleUsageDeduction,
  recordBonus,
  recordPenalty,
  recordDailyWage,
  recordOvertime,
  recordAdjustment,
  type ActionState,
} from "@/server/compensation/actions";
import type { BonusRuleOption, PenaltyRuleOption } from "@/server/compensation/queries";
import { formatILS } from "@/server/money";
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
import { JobCombobox } from "../job-combobox";

const initialState: ActionState = {};
const CUSTOM_VALUE = "__custom__";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "جارٍ الحفظ..." : label}
    </Button>
  );
}

/** MANAGE_TECHNICIAN_PAYMENTS-only quick action — vehicle usage deduction
 * (section 26). Amount is optional; leaving it empty applies the
 * application-wide default (vehicle_usage_deduction_default setting). */
export function VehicleDeductionDialog({
  userId,
  defaultAmount,
}: {
  userId: string;
  defaultAmount: string;
}) {
  const [open, setOpen] = React.useState(false);
  const action = recordVehicleUsageDeduction.bind(null, userId);
  const [state, formAction] = useActionState(action, initialState);

  useCloseOnSuccess(state, setOpen);

  const [prevState, setPrevState] = React.useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state.success) toast.success("تم تسجيل الخصم.");
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Car className="size-4" />
          خصم استخدام مركبة
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>خصم استخدام مركبة</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="vehicle-amount">المبلغ (اختياري)</Label>
            <Input
              id="vehicle-amount"
              name="amount"
              type="text"
              inputMode="decimal"
              dir="ltr"
              placeholder={defaultAmount}
            />
            <p className="text-xs text-muted-foreground">
              يُطبَّق المبلغ الافتراضي من الإعدادات ({formatILS(defaultAmount)}) إن تُرك فارغاً.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="vehicle-reason">ملاحظة (اختياري)</Label>
            <Textarea id="vehicle-reason" name="reason" />
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
            <SubmitButton label="تسجيل الخصم" />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** MANAGE_TECHNICIAN_PAYMENTS-only quick action — a bonus (section 31),
 * from a predefined rule or fully custom. */
export function BonusDialog({ userId, bonusRules }: { userId: string; bonusRules: BonusRuleOption[] }) {
  const [open, setOpen] = React.useState(false);
  const [ruleId, setRuleId] = React.useState<string>(bonusRules[0]?.id ?? CUSTOM_VALUE);
  const action = recordBonus.bind(null, userId);
  const [state, formAction] = useActionState(action, initialState);

  useCloseOnSuccess(state, setOpen);

  const [prevState, setPrevState] = React.useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state.success) toast.success("تم تسجيل المكافأة.");
  }

  const isCustom = ruleId === CUSTOM_VALUE;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
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
          <div className="space-y-2">
            <Label htmlFor="bonus-rule">نوع المكافأة *</Label>
            <Select value={ruleId} onValueChange={setRuleId}>
              <SelectTrigger id="bonus-rule">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {bonusRules.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.label}
                  </SelectItem>
                ))}
                <SelectItem value={CUSTOM_VALUE}>مخصص...</SelectItem>
              </SelectContent>
            </Select>
            {!isCustom && <input type="hidden" name="bonusRuleId" value={ruleId} />}
          </div>
          {isCustom && (
            <div className="space-y-2">
              <Label htmlFor="bonus-description">الوصف *</Label>
              <Input id="bonus-description" name="customDescription" required />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="bonus-amount">
              المبلغ {isCustom ? "*" : "(اختياري، يحل محل القيمة الافتراضية)"}
            </Label>
            <Input
              id="bonus-amount"
              name="amount"
              type="text"
              inputMode="decimal"
              dir="ltr"
              required={isCustom}
            />
          </div>
          <div className="space-y-2">
            <Label>المهمة (اختياري)</Label>
            <JobCombobox name="jobId" />
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
            <SubmitButton label="تسجيل المكافأة" />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** MANAGE_TECHNICIAN_PAYMENTS-only quick action — a penalty (section 30).
 * A reason is always required so the technician can see why. */
export function PenaltyDialog({ userId, penaltyRules }: { userId: string; penaltyRules: PenaltyRuleOption[] }) {
  const [open, setOpen] = React.useState(false);
  const [ruleId, setRuleId] = React.useState<string>(penaltyRules[0]?.id ?? CUSTOM_VALUE);
  const action = recordPenalty.bind(null, userId);
  const [state, formAction] = useActionState(action, initialState);

  useCloseOnSuccess(state, setOpen);

  const [prevState, setPrevState] = React.useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state.success) toast.success("تم تسجيل المخالفة.");
  }

  const isCustom = ruleId === CUSTOM_VALUE;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="text-destructive hover:text-destructive">
          <AlertTriangle className="size-4" />
          غرامة
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>تسجيل مخالفة / غرامة</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="penalty-rule">نوع المخالفة *</Label>
            <Select value={ruleId} onValueChange={setRuleId}>
              <SelectTrigger id="penalty-rule">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {penaltyRules.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.label}
                  </SelectItem>
                ))}
                <SelectItem value={CUSTOM_VALUE}>مخصص...</SelectItem>
              </SelectContent>
            </Select>
            {!isCustom && <input type="hidden" name="penaltyRuleId" value={ruleId} />}
          </div>
          {isCustom && (
            <div className="space-y-2">
              <Label htmlFor="penalty-description">الوصف *</Label>
              <Input id="penalty-description" name="customDescription" required />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="penalty-amount">
              المبلغ {isCustom ? "*" : "(اختياري، يحل محل القيمة الافتراضية)"}
            </Label>
            <Input
              id="penalty-amount"
              name="amount"
              type="text"
              inputMode="decimal"
              dir="ltr"
              required={isCustom}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="penalty-reason">سبب المخالفة *</Label>
            <Textarea id="penalty-reason" name="reason" required />
          </div>
          <div className="space-y-2">
            <Label>المهمة (اختياري)</Label>
            <JobCombobox name="jobId" />
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
            <SubmitButton label="تسجيل المخالفة" />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** MANAGE_TECHNICIAN_PAYMENTS-only quick action — a daily wage entry
 * (section 27). Amount is optional; leaving it empty falls back to the
 * technician's own users.dailyWageAmount server-side. */
export function DailyWageDialog({ userId }: { userId: string }) {
  const [open, setOpen] = React.useState(false);
  const action = recordDailyWage.bind(null, userId);
  const [state, formAction] = useActionState(action, initialState);
  const today = new Date().toISOString().slice(0, 10);

  useCloseOnSuccess(state, setOpen);

  const [prevState, setPrevState] = React.useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state.success) toast.success("تم تسجيل الأجر اليومي.");
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <CalendarClock className="size-4" />
          دفعة يومية
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>تسجيل أجر يومي</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="wage-date">التاريخ *</Label>
            <Input id="wage-date" name="date" type="date" defaultValue={today} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="wage-amount">المبلغ (اختياري، افتراضياً الأجر اليومي المحدد للمستخدم)</Label>
            <Input id="wage-amount" name="amount" type="text" inputMode="decimal" dir="ltr" />
          </div>
          <div className="space-y-2">
            <Label>المهمة (اختياري)</Label>
            <JobCombobox name="jobId" />
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
            <SubmitButton label="تسجيل" />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** MANAGE_TECHNICIAN_PAYMENTS-only quick action — overtime pay (Sprint 7),
 * hours × hourly rate, both stored on the ledger row itself. */
export function OvertimeDialog({ userId }: { userId: string }) {
  const [open, setOpen] = React.useState(false);
  const action = recordOvertime.bind(null, userId);
  const [state, formAction] = useActionState(action, initialState);

  useCloseOnSuccess(state, setOpen);

  const [prevState, setPrevState] = React.useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state.success) toast.success("تم تسجيل العمل الإضافي.");
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Clock className="size-4" />
          عمل إضافي
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>تسجيل عمل إضافي</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="space-y-4" noValidate>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="overtime-hours">عدد الساعات *</Label>
              <Input
                id="overtime-hours"
                name="hours"
                type="text"
                inputMode="decimal"
                dir="ltr"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="overtime-rate">أجر الساعة *</Label>
              <Input
                id="overtime-rate"
                name="hourlyRate"
                type="text"
                inputMode="decimal"
                dir="ltr"
                required
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>المهمة (اختياري)</Label>
            <JobCombobox name="jobId" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="overtime-notes">ملاحظات (اختياري)</Label>
            <Textarea id="overtime-notes" name="notes" />
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
            <SubmitButton label="تسجيل" />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** MANAGE_TECHNICIAN_PAYMENTS-only quick action — a free-form ledger
 * adjustment (Sprint 7), for a manual correction that doesn't fit any of
 * the other, more specific quick actions above. */
export function AdjustmentDialog({ userId }: { userId: string }) {
  const [open, setOpen] = React.useState(false);
  const action = recordAdjustment.bind(null, userId);
  const [state, formAction] = useActionState(action, initialState);

  useCloseOnSuccess(state, setOpen);

  const [prevState, setPrevState] = React.useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state.success) toast.success("تم تسجيل التسوية.");
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Scale className="size-4" />
          تسوية حساب
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>تسجيل تسوية حساب</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="adjustment-direction">الاتجاه *</Label>
            <Select name="direction" required defaultValue="credit">
              <SelectTrigger id="adjustment-direction">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="credit">إضافة للحساب (لصالح الفني)</SelectItem>
                <SelectItem value="debit">خصم من الحساب</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="adjustment-amount">المبلغ *</Label>
            <Input
              id="adjustment-amount"
              name="amount"
              type="text"
              inputMode="decimal"
              dir="ltr"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="adjustment-description">وصف التسوية *</Label>
            <Textarea id="adjustment-description" name="description" required />
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
            <SubmitButton label="تسجيل" />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
