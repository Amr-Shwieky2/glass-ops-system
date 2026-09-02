"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import {
  estimateCommission,
  finalizeCommission,
  type ActionState,
} from "@/server/compensation/commission";
import { Button } from "@/components/ui/button";

const initialState: ActionState = {};

function ActionButton({
  label,
  pendingLabel,
  variant,
}: {
  label: string;
  pendingLabel: string;
  variant?: "outline" | "default";
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant={variant ?? "outline"} disabled={pending}>
      {pending ? pendingLabel : label}
    </Button>
  );
}

function useToastOnResult(state: ActionState, successMessage: string) {
  const [prevState, setPrevState] = React.useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state.success) toast.success(successMessage);
    else if (state.error) toast.error(state.error);
  }
}

export function EstimateCommissionButton({ jobId }: { jobId: string }) {
  const action = estimateCommission.bind(null, jobId);
  const [state, formAction] = useActionState(action, initialState);
  useToastOnResult(state, "تم تحديث تقدير العمولة.");

  return (
    <form action={formAction}>
      <ActionButton label="تقدير العمولة" pendingLabel="جارٍ الحساب..." />
    </form>
  );
}

/**
 * `isFinalized` only controls what this component RENDERS, never whether
 * it renders at all — the parent must always mount this component (never
 * conditionally on commission.status), or the finalize success toast is
 * lost: the server action's revalidatePath refresh and this component's
 * own useActionState result land in the same commit, so if the parent
 * were to unmount this component once finalized=true, its toast-firing
 * render would never happen. Returning null here (after the hooks run
 * unconditionally, same fiber preserved) keeps the toast reliable while
 * still hiding the button once there's nothing left to finalize.
 */
export function FinalizeCommissionButton({
  jobId,
  isFinalized,
}: {
  jobId: string;
  isFinalized: boolean;
}) {
  const action = finalizeCommission.bind(null, jobId);
  const [state, formAction] = useActionState(action, initialState);
  useToastOnResult(state, "تم اعتماد العمولة النهائية.");

  if (isFinalized) return null;

  return (
    <form action={formAction}>
      <ActionButton label="اعتماد العمولة النهائية" pendingLabel="جارٍ الاعتماد..." />
    </form>
  );
}
