"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { MapPin } from "lucide-react";
import { markAppointmentArrivedAction, type ActionState } from "@/server/appointments/actions";
import { Button } from "@/components/ui/button";

const initialState: ActionState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="secondary" disabled={pending}>
      <MapPin className="size-4" />
      {pending ? "جارٍ التحديث..." : "وصلت الموقع"}
    </Button>
  );
}

/**
 * One-tap "وصلت الموقع" (My Day). No dialog — a bare form so
 * useFormStatus disables the button for the length of the request, which
 * (together with markAppointmentArrivedAction's race-safe conditional
 * UPDATE) is what actually prevents a double-tap double-transition; this
 * is just the UI not inviting one. The card unmounts this button on its
 * own once the parent re-renders with status='arrived' (via
 * revalidatePath), so there's no local "already arrived" state to track
 * here.
 */
export function ArrivedButton({ appointmentId }: { appointmentId: string }) {
  const action = markAppointmentArrivedAction.bind(null, appointmentId);
  const [state, formAction] = useActionState(action, initialState);

  // Same "adjust state while rendering" recipe as useCloseOnSuccess
  // (src/lib/use-close-on-success.ts) — there's no dialog to close here,
  // just an error to surface once per fresh result.
  const [prevState, setPrevState] = React.useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state.error) toast.error(state.error);
  }

  return (
    <form action={formAction}>
      <SubmitButton />
    </form>
  );
}
