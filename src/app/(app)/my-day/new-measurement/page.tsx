import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getCurrentUser } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { PERMISSIONS } from "@/server/auth/permission-keys";
import { getGlassTypes } from "@/server/measurements/queries";
import { Forbidden } from "@/components/forbidden";
import { NewMeasurementForm } from "./new-measurement-form";

export const metadata: Metadata = {
  title: "قياس جديد | نظام إدارة عمليات الزجاج",
};

/**
 * New Measurement quick-submit flow (docs/superpowers/specs/
 * 2026-09-03-new-measurement-quick-submit-design.md section 7 step 2) — a
 * dedicated full-page mobile route rather than a dialog, since file
 * pickers are awkward inside a modal. Gated on CREATE_MEASUREMENT only,
 * matching the My Day quick action that links here and the server action
 * this form submits to.
 */
export default async function NewMeasurementPage() {
  const user = await getCurrentUser();
  if (!can(user, PERMISSIONS.CREATE_MEASUREMENT)) {
    return <Forbidden />;
  }

  const glassTypes = await getGlassTypes();

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <Link
        href="/my-day"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4 rotate-180" />
        العودة إلى يومي
      </Link>

      <div>
        <h1 className="text-2xl font-bold text-foreground">قياس جديد</h1>
        <p className="text-sm text-muted-foreground">
          سجّل قياساً من الموقع — سيتم إنشاء مهمة جديدة تلقائياً وإرسالها لفريق التسعير.
        </p>
      </div>

      <NewMeasurementForm glassTypes={glassTypes} />
    </div>
  );
}
