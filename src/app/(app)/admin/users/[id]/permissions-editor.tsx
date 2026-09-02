"use client";

import * as React from "react";
import { toast } from "sonner";
import { grantPermissionAction, revokePermissionAction } from "@/server/users/actions";
import { PERMISSION_CATALOGUE, type PermissionKey } from "@/server/auth/permission-keys";
import { Checkbox } from "@/components/ui/checkbox";

/**
 * Groups PERMISSION_CATALOGUE by its own `category` field, preserving the
 * catalogue's own ordering (first-seen category order, items in catalogue
 * order within it) — per the task instructions, this reuses that grouping
 * directly rather than re-deriving categories.
 */
const CATEGORIES: { category: string; items: typeof PERMISSION_CATALOGUE }[] = (() => {
  const order: string[] = [];
  const map = new Map<string, typeof PERMISSION_CATALOGUE>();
  for (const item of PERMISSION_CATALOGUE) {
    if (!map.has(item.category)) {
      map.set(item.category, []);
      order.push(item.category);
    }
    map.get(item.category)!.push(item);
  }
  return order.map((category) => ({ category, items: map.get(category)! }));
})();

/**
 * One checkbox per permission, grouped by category, toggling immediately
 * (grant/revoke) with no separate save step — matches section 7/77's
 * framing of permissions as instantly-effective independent toggles.
 * When `editable` is false (viewer lacks MANAGE_PERMISSIONS) the same list
 * renders read-only so a MANAGE_USERS-only admin can still see what a user
 * can do.
 */
export function PermissionsEditor({
  userId,
  initialGranted,
  editable,
}: {
  userId: string;
  initialGranted: string[];
  editable: boolean;
}) {
  const [granted, setGranted] = React.useState<Set<string>>(() => new Set(initialGranted));
  const [pendingKey, setPendingKey] = React.useState<string | null>(null);

  function toggle(key: PermissionKey, nextChecked: boolean) {
    if (!editable || pendingKey) return;
    setPendingKey(key);
    const action = nextChecked ? grantPermissionAction : revokePermissionAction;
    action(userId, key, {}, new FormData())
      .then((result) => {
        if (result.error) {
          toast.error(result.error);
          return;
        }
        setGranted((prev) => {
          const next = new Set(prev);
          if (nextChecked) next.add(key);
          else next.delete(key);
          return next;
        });
      })
      .finally(() => setPendingKey(null));
  }

  return (
    <div className="space-y-6">
      {CATEGORIES.map(({ category, items }) => (
        <div key={category}>
          <h3 className="mb-2 text-sm font-semibold text-foreground">{category}</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {items.map((item) => {
              const checked = granted.has(item.key);
              return (
                <label
                  key={item.key}
                  className="flex items-start gap-2 rounded-md border border-border p-2 text-start"
                >
                  <Checkbox
                    checked={checked}
                    disabled={!editable || pendingKey === item.key}
                    onCheckedChange={(value) => toggle(item.key, value === true)}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="block text-sm font-medium text-foreground">
                      {item.label}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {item.description}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
