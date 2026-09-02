"use client";

import * as React from "react";
import { useTransition } from "react";
import { toast } from "sonner";
import { CheckCircle2 } from "lucide-react";
import { completeInstallationAction } from "@/server/appointments/complete-installation";
import type { MyDayJobItem } from "@/server/appointments/queries";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

const PAYMENT_METHOD_OPTIONS: { value: string; label: string }[] = [
  { value: "cash", label: "نقدية" },
  { value: "bank_transfer", label: "تحويل بنكي" },
  { value: "check", label: "شيك" },
  { value: "other", label: "أخرى" },
];

export function CompleteInstallationDialog({
  appointmentId,
  pendingItems,
}: {
  appointmentId: string;
  pendingItems: MyDayJobItem[];
}) {
  const [open, setOpen] = React.useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = React.useState<string | undefined>();

  // Minimum-input principle: every item defaults to "installed" — the
  // technician unchecks anything not actually done, rather than opting
  // items in one by one.
  const [selectedItemIds, setSelectedItemIds] = React.useState<string[]>(() =>
    pendingItems.map((i) => i.id),
  );
  const [photoTaken, setPhotoTaken] = React.useState(false);
  const [paymentCollected, setPaymentCollected] = React.useState(false);
  const [paymentAmount, setPaymentAmount] = React.useState("");
  const [paymentMethod, setPaymentMethod] = React.useState("cash");
  const [note, setNote] = React.useState("");

  function toggleItem(itemId: string, checked: boolean) {
    setSelectedItemIds((prev) =>
      checked ? [...prev, itemId] : prev.filter((id) => id !== itemId),
    );
  }

  function handleSubmit() {
    setError(undefined);
    startTransition(async () => {
      const result = await completeInstallationAction({
        appointmentId,
        jobItemIds: selectedItemIds,
        photoTaken,
        paymentCollected,
        paymentAmount: paymentCollected ? paymentAmount : undefined,
        paymentMethod: paymentCollected
          ? (paymentMethod as "cash" | "bank_transfer" | "check" | "other")
          : undefined,
        note: note.trim() || undefined,
      });
      if (result.error) {
        setError(result.error);
        toast.error(result.error);
      } else {
        toast.success("تم إكمال التركيب.");
        setOpen(false);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <CheckCircle2 className="size-4" />
          إكمال التركيب
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>إكمال التركيب</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {pendingItems.length > 0 && (
            <div className="space-y-2">
              <Label>البنود المركَّبة</Label>
              <div className="max-h-40 space-y-2 overflow-y-auto rounded-md border p-3">
                {pendingItems.map((item) => (
                  <div key={item.id} className="flex items-center gap-2">
                    <Checkbox
                      id={`item-${item.id}`}
                      checked={selectedItemIds.includes(item.id)}
                      onCheckedChange={(checked) => toggleItem(item.id, checked === true)}
                    />
                    <Label htmlFor={`item-${item.id}`} className="font-normal">
                      {item.workTypeLabelAr ?? item.description ?? "بند عمل"}
                      {` (${item.quantity} ${item.unit ?? ""})`}
                    </Label>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="photoTaken" className="font-normal">
              تم توثيق الصور
            </Label>
            <Switch id="photoTaken" checked={photoTaken} onCheckedChange={setPhotoTaken} />
          </div>

          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="paymentCollected" className="font-normal">
              تم تحصيل الدفعة
            </Label>
            <Switch
              id="paymentCollected"
              checked={paymentCollected}
              onCheckedChange={setPaymentCollected}
            />
          </div>

          {paymentCollected && (
            <div className="space-y-4 rounded-md border p-3">
              <div className="space-y-2">
                <Label htmlFor="paymentAmount">المبلغ *</Label>
                <Input
                  id="paymentAmount"
                  type="text"
                  inputMode="decimal"
                  dir="ltr"
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="paymentMethod">طريقة الدفع *</Label>
                <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                  <SelectTrigger id="paymentMethod">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHOD_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="note">ملاحظات (اختياري)</Label>
            <Textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>

          {error && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            إلغاء
          </Button>
          <Button type="button" disabled={isPending} onClick={handleSubmit}>
            {isPending ? "جارٍ الحفظ..." : "إكمال التركيب"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
