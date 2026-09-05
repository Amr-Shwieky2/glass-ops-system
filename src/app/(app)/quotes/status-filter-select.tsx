"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { QUOTE_STATUS_LABEL } from "@/lib/quote-status-style";

const ALL_VALUE = "__all__";

// quote_status is a fixed, small, code-level enum (see enums.ts) — no
// lookup-table fetch needed, unlike the job-status filter's DB-driven list.
const STATUS_OPTIONS = Object.entries(QUOTE_STATUS_LABEL);

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
    next.delete("page");
    router.push(`${pathname}?${next.toString()}`);
  }

  return (
    <Select defaultValue={defaultValue ?? ALL_VALUE} onValueChange={handleChange}>
      <SelectTrigger className="w-56">
        <SelectValue placeholder="كل الحالات" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL_VALUE}>كل الحالات</SelectItem>
        {STATUS_OPTIONS.map(([key, label]) => (
          <SelectItem key={key} value={key}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
