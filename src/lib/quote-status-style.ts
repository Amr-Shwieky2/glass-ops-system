import type { VariantProps } from "class-variance-authority";
import type { badgeVariants } from "@/components/ui/badge";

type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>["variant"]>;

/** quote_status (quotes.status) — a fixed code-level enum (see enums.ts),
 * not a lookup table, so this small map is shared between the job-level
 * quote section and the /quotes list page. */
export const QUOTE_STATUS_LABEL: Record<string, string> = {
  draft: "مسودة",
  sent: "بانتظار توقيع العميل",
  signed: "موقّع",
  expired: "منتهي الصلاحية",
  superseded: "مستبدل",
};

const QUOTE_STATUS_VARIANT: Record<string, BadgeVariant> = {
  draft: "outline",
  sent: "warning",
  signed: "success",
  expired: "destructive",
  superseded: "outline",
};

export function quoteStatusVariant(status: string): BadgeVariant {
  return QUOTE_STATUS_VARIANT[status] ?? "default";
}
