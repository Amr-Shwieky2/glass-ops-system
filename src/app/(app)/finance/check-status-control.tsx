"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import {
  updateIncomingCheckStatusAction,
  updateOutgoingCheckStatusAction,
} from "@/server/checks/actions";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

const INCOMING_TARGET_OPTIONS: { value: string; label: string }[] = [
  { value: "deposited", label: "تم الإيداع" },
  { value: "cleared", label: "تم التحصيل" },
  { value: "failed", label: "فشل / ارتجع" },
  { value: "cancelled", label: "ملغى" },
];

const OUTGOING_TARGET_OPTIONS: { value: string; label: string }[] = [
  { value: "issued", label: "تم الإصدار" },
  { value: "cleared", label: "تم الصرف" },
  { value: "failed", label: "فشل / ارتجع" },
  { value: "cancelled", label: "ملغى" },
];

/**
 * MANAGE_CHECKS-only explicit status control. Deliberately never
 * auto-transitions a check — every value here is a person's explicit
 * choice, submitted immediately on selection (section 39: "Someone must
 * explicitly select ... Never automatically assume that a check cleared").
 * A placeholder option lets the control always start unselected so picking
 * the CURRENT status again still fires a change and gives feedback, rather
 * than silently doing nothing because Radix suppresses a no-op selection.
 */
function CheckStatusControl({
  checkId,
  kind,
  options,
}: {
  checkId: string;
  kind: "incoming" | "outgoing";
  options: { value: string; label: string }[];
}) {
  const [isPending, startTransition] = useTransition();
  const action = kind === "incoming" ? updateIncomingCheckStatusAction : updateOutgoingCheckStatusAction;

  return (
    <Select
      disabled={isPending}
      onValueChange={(value) => {
        startTransition(async () => {
          const formData = new FormData();
          formData.set("status", value);
          const result = await action(checkId, {}, formData);
          if (result.error) toast.error(result.error);
          else toast.success("تم تحديث حالة الشيك.");
        });
      }}
    >
      <SelectTrigger size="sm" className="w-40">
        <SelectValue placeholder="تحديث الحالة..." />
      </SelectTrigger>
      <SelectContent>
        {options.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function IncomingCheckStatusControl({ checkId }: { checkId: string }) {
  return <CheckStatusControl checkId={checkId} kind="incoming" options={INCOMING_TARGET_OPTIONS} />;
}

export function OutgoingCheckStatusControl({ checkId }: { checkId: string }) {
  return <CheckStatusControl checkId={checkId} kind="outgoing" options={OUTGOING_TARGET_OPTIONS} />;
}
