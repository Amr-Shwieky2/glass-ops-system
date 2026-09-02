"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

interface StatusOption {
  key: string;
  labelAr: string;
}

const ALL_VALUE = "__all__";

/**
 * Same GET-param-driven pattern as src/app/(app)/jobs/status-filter-select.tsx
 * and admin/audit-log/audit-filters.tsx (auto-navigates on change, preserving
 * every other query param — including `tab`) — kept as its own small copy
 * here rather than imported cross-route-group, and using the param name
 * "statusKey" (not "status") so it matches src/server/reports/queries.ts's
 * getJobsReport filter and the CSV export route exactly, with no renaming
 * needed when building the export link.
 */
export function JobsStatusFilter({
  statuses,
  defaultValue,
}: {
  statuses: StatusOption[];
  defaultValue?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function handleChange(value: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (value === ALL_VALUE) next.delete("statusKey");
    else next.set("statusKey", value);
    router.push(`${pathname}?${next.toString()}`);
  }

  return (
    <Select defaultValue={defaultValue ?? ALL_VALUE} onValueChange={handleChange}>
      <SelectTrigger className="w-56">
        <SelectValue placeholder="كل الحالات" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL_VALUE}>كل الحالات</SelectItem>
        {statuses.map((s) => (
          <SelectItem key={s.key} value={s.key}>
            {s.labelAr}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
