"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

const ALL_VALUE = "__all__";

// repair_status is a fixed, small, code-level enum (see enums.ts) — no
// lookup-table fetch needed, same reasoning as production's status filter.
const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "open", label: "مفتوح" },
  { value: "scheduled", label: "مجدول" },
  { value: "in_progress", label: "قيد التنفيذ" },
  { value: "resolved", label: "تم الحل" },
];

export function StatusFilterSelect({ defaultValue }: { defaultValue?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function handleChange(value: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (value === ALL_VALUE) {
      next.delete("status");
    } else {
      next.set("status", value);
    }
    router.push(`${pathname}?${next.toString()}`);
  }

  return (
    <Select defaultValue={defaultValue ?? ALL_VALUE} onValueChange={handleChange}>
      <SelectTrigger className="w-56">
        <SelectValue placeholder="كل الحالات" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL_VALUE}>كل الحالات</SelectItem>
        {STATUS_OPTIONS.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
