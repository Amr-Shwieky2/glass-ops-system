import type { VariantProps } from "class-variance-authority";
import type { badgeVariants } from "@/components/ui/badge";

type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>["variant"]>;

// Falls back to "default" for any status key not listed here, so a status
// an admin adds later via Settings (Phase 10) still renders, just plainly.
const STATUS_VARIANTS: Record<string, BadgeVariant> = {
  new_lead: "info",
  measurement_scheduled: "info",
  measurement_completed: "info",
  field_submission_pending: "warning",
  waiting_for_pricing: "warning",
  quote_sent: "warning",
  waiting_for_customer_approval: "warning",
  quote_signed: "primary",
  waiting_for_production: "primary",
  in_production: "primary",
  ready_from_factory: "primary",
  installation_scheduled: "primary",
  installation_in_progress: "primary",
  installed: "success",
  repair_needed: "destructive",
  repair_scheduled: "warning",
  completed: "success",
  cancelled: "outline",
};

export function jobStatusVariant(key: string): BadgeVariant {
  return STATUS_VARIANTS[key] ?? "default";
}
