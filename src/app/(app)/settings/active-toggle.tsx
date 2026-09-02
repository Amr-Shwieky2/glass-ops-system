"use client";

import * as React from "react";
import { useTransition } from "react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";

interface ActionResult {
  error?: string;
  success?: boolean;
}

/**
 * A live isActive switch for one row of a Settings admin table (job
 * statuses / work types / compensation / penalty / bonus rules). Flips
 * immediately (optimistic), calls the row's own update action with every
 * other field unchanged and only isActive toggled, and reverts + toasts
 * the backend's Arabic "in use" error on failure — this is the deactivate
 * path the backend's updateXAction in-use guards protect, so errors here
 * are expected, not exceptional, and must never fail silently.
 */
export function ActiveToggle({
  checked,
  onToggle,
  disabled,
}: {
  checked: boolean;
  onToggle: (next: boolean) => Promise<ActionResult>;
  disabled?: boolean;
}) {
  const [optimistic, setOptimistic] = React.useState(checked);
  const [isPending, startTransition] = useTransition();

  return (
    <Switch
      checked={optimistic}
      disabled={disabled || isPending}
      onCheckedChange={(next) => {
        setOptimistic(next);
        startTransition(async () => {
          const result = await onToggle(next);
          if (result.error) {
            setOptimistic(!next);
            toast.error(result.error);
          }
        });
      }}
    />
  );
}
