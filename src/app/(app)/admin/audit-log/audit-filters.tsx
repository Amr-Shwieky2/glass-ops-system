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
 * Arabic labels for the audit trail's entityType values (section 62 is an
 * admin/debugging screen, but the filter chrome itself is user-facing text
 * and follows the rest of the app in being Arabic). Sourced from every
 * `entityType: "..."` literal actually written by recordAudit() call sites
 * across src/server.
 */
const ENTITY_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "user", label: "مستخدم" },
  { value: "customer", label: "عميل" },
  { value: "job", label: "مهمة" },
  { value: "job_status", label: "حالة مهمة" },
  { value: "work_type", label: "نوع عمل" },
  { value: "quote", label: "عرض سعر" },
  { value: "customer_payment", label: "دفعة عميل" },
  { value: "production_request", label: "طلب إنتاج" },
  { value: "factory_submission", label: "تسعير المصنع" },
  { value: "job_cost", label: "تكلفة مهمة" },
  { value: "technician_ledger_entry", label: "قيد فني" },
  { value: "compensation_rule", label: "قاعدة تعويض" },
  { value: "penalty_rule", label: "قاعدة خصم" },
  { value: "bonus_rule", label: "قاعدة مكافأة" },
  { value: "vehicle", label: "مركبة" },
  { value: "fuel_log", label: "سجل وقود" },
  { value: "incoming_check", label: "شيك وارد" },
  { value: "outgoing_check", label: "شيك صادر" },
  { value: "cash_transfer", label: "تحويل نقدي" },
  { value: "commission", label: "عمولة" },
  { value: "repair", label: "إصلاح" },
  { value: "application_setting", label: "إعداد عام" },
];

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
