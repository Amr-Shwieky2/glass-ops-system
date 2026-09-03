import Link from "next/link";
import { Ruler } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * My Day's "قياس جديد" quick action (New Measurement quick-submit flow,
 * docs/superpowers/specs/2026-09-03-new-measurement-quick-submit-design.md
 * section 7 step 1) — same visual weight/placement as AddFuelQuickAction
 * (add-fuel-quick-action.tsx), but links to a dedicated full page instead
 * of opening a dialog: the spec calls for a real page because file pickers
 * are awkward inside a modal. The caller (my-day/page.tsx) is responsible
 * for only rendering this when the current user holds CREATE_MEASUREMENT.
 */
export function NewMeasurementQuickAction() {
  return (
    <Button asChild size="lg" className="w-full">
      <Link href="/my-day/new-measurement">
        <Ruler className="size-4" />
        قياس جديد
      </Link>
    </Button>
  );
}
