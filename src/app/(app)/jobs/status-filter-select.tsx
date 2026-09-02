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

export function StatusFilterSelect({
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
        {statuses.map((s) => (
          <SelectItem key={s.key} value={s.key}>
            {s.labelAr}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
