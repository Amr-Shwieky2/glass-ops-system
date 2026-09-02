import type { VariantProps } from "class-variance-authority";
import type { badgeVariants } from "@/components/ui/badge";

type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>["variant"]>;

/** factory_status (production_requests.status) — a fixed code-level enum
 * (see enums.ts), not a lookup table, so this small map is shared between
 * the job-level production section and the /production queue page. */
export const PRODUCTION_STATUS_LABEL: Record<string, string> = {
  pending: "بانتظار إرسال المصنع",
  submitted: "بانتظار اعتماد السعر",
  approved: "معتمد",
  rejected: "مرفوض — بانتظار سعر جديد",
};

const PRODUCTION_STATUS_VARIANT: Record<string, BadgeVariant> = {
  pending: "outline",
  submitted: "warning",
  approved: "success",
  rejected: "destructive",
};

export function productionStatusVariant(status: string): BadgeVariant {
  return PRODUCTION_STATUS_VARIANT[status] ?? "default";
}
