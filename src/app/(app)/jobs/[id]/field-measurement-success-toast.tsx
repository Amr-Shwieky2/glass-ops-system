"use client";

import * as React from "react";
import { toast } from "sonner";

const SUBMITTED_FLAG_KEY = "fieldMeasurementSubmittedAt";
// A landing well after the flag was set can't be this submission's own
// redirect (e.g. the user later opens an unrelated job that happens to
// still be at this status) — bound how long the flag stays "fresh".
const FRESHNESS_WINDOW_MS = 15_000;

/**
 * Shows a one-time success toast when the job detail page is the landing
 * page of a New Measurement quick-submit (docs/superpowers/specs/
 * 2026-09-03-new-measurement-quick-submit-design.md section 7 step 3).
 *
 * submitFieldMeasurementAction redirects straight to `/jobs/:id` on
 * success (matching createJob's own convention — see its report: "never
 * returns {success:true} in the happy path"), so a useActionState result
 * on the submitting page never carries a `success` flag to react to — the
 * component that called the action unmounts as the browser navigates away.
 * The submitting form (new-measurement-form.tsx) works around this by
 * writing a timestamp to sessionStorage right before the browser-native
 * submission it can't intercept the outcome of; this component, rendered
 * only on the status this flow's jobs start at, claims and clears that
 * flag once, within a short freshness window, so an unrelated later visit
 * to a job still sitting at this status never shows a stale toast.
 */
export function FieldMeasurementSuccessToast({ statusKey }: { statusKey: string }) {
  React.useEffect(() => {
    if (statusKey !== "field_submission_pending") return;
    try {
      const raw = sessionStorage.getItem(SUBMITTED_FLAG_KEY);
      if (!raw) return;
      sessionStorage.removeItem(SUBMITTED_FLAG_KEY);
      const submittedAt = Number(raw);
      if (Number.isFinite(submittedAt) && Date.now() - submittedAt < FRESHNESS_WINDOW_MS) {
        toast.success("تم إرسال القياس الميداني بنجاح، وهو الآن بانتظار مراجعة التسعير.");
      }
    } catch {
      // Private browsing / storage disabled — no toast, nothing to clean up.
    }
  }, [statusKey]);

  return null;
}
