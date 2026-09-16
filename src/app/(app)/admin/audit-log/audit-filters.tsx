"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { ENTITY_TYPE_OPTIONS } from "@/lib/audit-labels";

const ALL_VALUE = "__all__";

export function EntityTypeFilterSelect({ defaultValue }: { defaultValue?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function handleChange(value: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (value === ALL_VALUE) next.delete("entityType");
    else next.set("entityType", value);
    next.delete("page");
    router.push(`${pathname}?${next.toString()}`);
  }

  return (
    <Select defaultValue={defaultValue ?? ALL_VALUE} onValueChange={handleChange}>
      <SelectTrigger className="w-48">
        <SelectValue placeholder="كل الأنواع" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL_VALUE}>كل الأنواع</SelectItem>
        {ENTITY_TYPE_OPTIONS.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function UserFilterSelect({
  users,
  defaultValue,
}: {
  users: { id: string; name: string }[];
  defaultValue?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function handleChange(value: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (value === ALL_VALUE) next.delete("userId");
    else next.set("userId", value);
    next.delete("page");
    router.push(`${pathname}?${next.toString()}`);
  }

  return (
    <Select defaultValue={defaultValue ?? ALL_VALUE} onValueChange={handleChange}>
      <SelectTrigger className="w-48">
        <SelectValue placeholder="كل المستخدمين" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL_VALUE}>كل المستخدمين</SelectItem>
        {users.map((u) => (
          <SelectItem key={u.id} value={u.id}>
            {u.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
