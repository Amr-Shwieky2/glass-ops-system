"use client";

import * as React from "react";
import { useTransition } from "react";
import { toast } from "sonner";
import { updateRepairStatusAction, type ActionState } from "@/server/repairs/actions";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

const initialState: ActionState = {};

const STATUS_OPTIONS: { value: "open" | "scheduled" | "in_progress" | "resolved"; label: string }[] = [
  { value: "open", label: "مفتوح" },
  { value: "scheduled", label: "مجدول" },
  { value: "in_progress", label: "قيد التنفيذ" },
  { value: "resolved", label: "تم الحل" },
];

/**
 * Per-row status control on the job's repairs section. Always sends an
 * explicit target status (never inferred) to updateRepairStatusAction,
 * which itself is the race-safe conditional-UPDATE guard against a
 * concurrent change — this control just surfaces the resulting error/lost
 * race, it does no optimistic update of its own (the list re-renders from
 * the revalidated server data on success).
 */
export function RepairStatusControl({
  repairId,
  status,
  scheduledDate,
}: {
  repairId: string;
  status: "open" | "scheduled" | "in_progress" | "resolved";
  scheduledDate: string | null;
}) {
  const [isPending, startTransition] = useTransition();

  function handleChange(next: string) {
    if (next === status) return;
    startTransition(async () => {
      const formData = new FormData();
      formData.set("status", next);
      // Preserve the existing scheduled date rather than silently wiping it
      // when moving between non-resolved statuses.
      if (next === "scheduled" && scheduledDate) {
        formData.set("scheduledDate", scheduledDate);
      }
      const result = await updateRepairStatusAction(repairId, initialState, formData);
      if (result.error) toast.error(result.error);
      else toast.success("تم تحديث حالة الإصلاح.");
    });
  }

  return (
    <Select value={status} onValueChange={handleChange} disabled={isPending}>
      <SelectTrigger className="w-40" size="sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {STATUS_OPTIONS.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
