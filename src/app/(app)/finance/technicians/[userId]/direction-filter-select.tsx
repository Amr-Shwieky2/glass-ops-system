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

/**
 * Cash-transaction direction filter for the cash drawer section below —
 * same GET-param-driven, auto-navigate-on-change pattern as
 * src/app/(app)/jobs/status-filter-select.tsx and
 * admin/audit-log/audit-filters.tsx.
 */
export function DirectionFilterSelect({ defaultValue }: { defaultValue?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function handleChange(value: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (value === ALL_VALUE) next.delete("direction");
    else next.set("direction", value);
    router.push(`${pathname}?${next.toString()}`);
  }

  return (
    <Select defaultValue={defaultValue ?? ALL_VALUE} onValueChange={handleChange}>
      <SelectTrigger className="w-40">
        <SelectValue placeholder="كل الحركات" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL_VALUE}>كل الحركات</SelectItem>
        <SelectItem value="in">دخول</SelectItem>
        <SelectItem value="out">خروج</SelectItem>
      </SelectContent>
    </Select>
  );
}
