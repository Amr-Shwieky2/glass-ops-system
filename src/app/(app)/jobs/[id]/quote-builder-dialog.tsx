"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Plus, Trash2, AlertTriangle } from "lucide-react";
import { saveQuoteDraft, type ActionState } from "@/server/quotes/actions";
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

export interface QuoteBuilderItem {
  workTypeId?: string;
  description: string;
  quantity: string;
  unit?: string;
  unitPrice: string;
}

interface Row extends QuoteBuilderItem {
  key: string;
}

let rowSeq = 0;
function newRow(initial?: QuoteBuilderItem): Row {
  rowSeq += 1;
  return {
    key: `r${rowSeq}`,
    workTypeId: initial?.workTypeId,
    description: initial?.description ?? "",
    quantity: initial?.quantity ?? "1",
    unit: initial?.unit ?? "",
    unitPrice: initial?.unitPrice ?? "",
  };
}

const initialState: ActionState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "جارٍ الحفظ..." : "حفظ عرض السعر"}
    </Button>
  );
}

export function QuoteBuilderDialog({
  jobId,
  quoteId,
  workTypes,
  initialItems,
  initialPaymentTerms,
  initialWorkTerms,
  initialValidUntil,
  triggerLabel,
  triggerVariant = "default",
  warnEditingSigned = false,
}: {
  jobId: string;
  quoteId?: string;
  workTypes: { id: string; labelAr: string; defaultUnit: string }[];
  initialItems?: QuoteBuilderItem[];
  initialPaymentTerms?: string;
  initialWorkTerms?: string;
  initialValidUntil?: string;
  triggerLabel: string;
  triggerVariant?: "default" | "outline" | "secondary";
  warnEditingSigned?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const action = saveQuoteDraft.bind(null, jobId);
  const [state, formAction] = useActionState(action, initialState);
  const [rows, setRows] = React.useState<Row[]>(() =>
    initialItems && initialItems.length > 0
      ? initialItems.map((i) => newRow(i))
      : [newRow()],
  );

  useCloseOnSuccess(state, setOpen);

  // Re-seed rows from props each time the dialog opens, so re-opening after
  // a save (or opening the "revise" dialog on a different quote) starts
  // from the latest content rather than stale state from the last time
  // this component instance was open. Compares against the previous
  // render's `open` instead of a useEffect (same "adjust state while
  // rendering" reasoning as useCloseOnSuccess above).
  const [prevOpen, setPrevOpen] = React.useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setRows(
        initialItems && initialItems.length > 0
          ? initialItems.map((i) => newRow(i))
          : [newRow()],
      );
    }
  }

  function updateRow(key: string, patch: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }
  function removeRow(key: string) {
    setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.key !== key) : prev));
  }

  const total = rows.reduce((sum, r) => {
    const q = Number(r.quantity) || 0;
    const p = Number(r.unitPrice) || 0;
    return sum + q * p;
  }, 0);

  const itemsJson = JSON.stringify(
    rows.map(({ key, ...rest }) => {
      void key;
      return rest;
    }),
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant={triggerVariant}>
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{triggerLabel}</DialogTitle>
        </DialogHeader>

        {warnEditingSigned && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <p>
              هذا العرض موقّع من العميل. حفظ أي تعديل سينشئ نسخة جديدة تحتاج توقيعاً جديداً،
              وسيُلغى رابط التوقيع الحالي تلقائياً.
            </p>
          </div>
        )}

        <form action={formAction} className="space-y-4" noValidate>
          <input type="hidden" name="quoteId" value={quoteId ?? ""} />
          <input type="hidden" name="itemsJson" value={itemsJson} />

          <div className="space-y-3">
            <Label>بنود العرض</Label>
            {rows.map((row) => (
              <div key={row.key} className="grid grid-cols-12 gap-2 rounded-lg border p-3">
                <div className="col-span-12 sm:col-span-4">
                  <Select
                    value={row.workTypeId}
                    onValueChange={(v) => {
                      const wt = workTypes.find((w) => w.id === v);
                      updateRow(row.key, {
                        workTypeId: v,
                        unit: row.unit || wt?.defaultUnit,
                      });
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="نوع العمل" />
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
                <div className="col-span-12 sm:col-span-4">
                  <Input
                    placeholder="الوصف"
                    value={row.description}
                    onChange={(e) => updateRow(row.key, { description: e.target.value })}
                  />
                </div>
                <div className="col-span-4 sm:col-span-1">
                  <Input
                    placeholder="الكمية"
                    dir="ltr"
                    inputMode="decimal"
                    value={row.quantity}
                    onChange={(e) => updateRow(row.key, { quantity: e.target.value })}
                  />
                </div>
                <div className="col-span-4 sm:col-span-1">
                  <Input
                    placeholder="الوحدة"
                    value={row.unit}
                    onChange={(e) => updateRow(row.key, { unit: e.target.value })}
                  />
                </div>
                <div className="col-span-3 sm:col-span-1">
                  <Input
                    placeholder="السعر"
                    dir="ltr"
                    inputMode="decimal"
                    value={row.unitPrice}
                    onChange={(e) => updateRow(row.key, { unitPrice: e.target.value })}
                  />
                </div>
                <div className="col-span-1 flex items-center justify-center">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeRow(row.key)}
                    disabled={rows.length === 1}
                    aria-label="حذف البند"
                  >
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={() => setRows((p) => [...p, newRow()])}>
              <Plus className="size-4" />
              إضافة بند
            </Button>
          </div>

          <div className="flex items-center justify-end border-t pt-3 text-base font-bold">
            <span dir="ltr">
              {new Intl.NumberFormat("ar", {
                style: "currency",
                currency: "ILS",
                numberingSystem: "latn",
                maximumFractionDigits: 2,
              }).format(total)}
            </span>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="paymentTerms">شروط الدفع</Label>
              <Textarea
                id="paymentTerms"
                name="paymentTerms"
                rows={3}
                defaultValue={initialPaymentTerms}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="workTerms">شروط العمل</Label>
              <Textarea id="workTerms" name="workTerms" rows={3} defaultValue={initialWorkTerms} />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="validUntil">صالح حتى</Label>
            <Input
              id="validUntil"
              name="validUntil"
              type="date"
              dir="ltr"
              defaultValue={initialValidUntil}
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
            <SubmitButton />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
