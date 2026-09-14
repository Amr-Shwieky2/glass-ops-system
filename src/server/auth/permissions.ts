import "server-only";
import type { AuthedUser } from "./session";
import { PERMISSIONS, type PermissionKey } from "./permission-keys";

/**
 * The ONE authorization check function. Every Server Action and Route
 * Handler that does anything sensitive must call requirePermission() (or
 * can() for a soft/conditional check) at the top, before touching the
 * database — never rely on a page-level redirect or a hidden button as
 * the only gate (section 7/75). A Next.js `proxy.ts` matcher exclusion
 * does NOT protect a Server Action, so this must run inside the action
 * itself, every time.
 */
export function can(
  user: AuthedUser | null,
  permission: PermissionKey,
): boolean {
  if (!user) return false;
  return user.permissions.has(permission);
}

export function canAny(
  user: AuthedUser | null,
  permissionList: PermissionKey[],
): boolean {
  return permissionList.some((p) => can(user, p));
}

export class ForbiddenError extends Error {
  constructor(permission?: string) {
    super(
      permission
        ? `You do not have permission to do this (missing: ${permission}).`
        : "You do not have permission to do this.",
    );
    this.name = "ForbiddenError";
  }
}

export class UnauthenticatedError extends Error {
  constructor() {
    super("You must be logged in.");
    this.name = "UnauthenticatedError";
  }
}

/** Throws instead of returning a boolean — for guarding a Server Action. */
export function requirePermission(
  user: AuthedUser | null,
  permission: PermissionKey,
): asserts user is AuthedUser {
  if (!user) throw new UnauthenticatedError();
  if (!user.permissions.has(permission)) throw new ForbiddenError(permission);
}

export function requireAnyPermission(
  user: AuthedUser | null,
  permissionList: PermissionKey[],
): asserts user is AuthedUser {
  if (!user) throw new UnauthenticatedError();
  if (!permissionList.some((p) => user.permissions.has(p))) {
    throw new ForbiddenError(permissionList.join(" or "));
  }
}

/** Guard for "logged in at all", no specific permission required. */
export function requireUser(
  user: AuthedUser | null,
): asserts user is AuthedUser {
  if (!user) throw new UnauthenticatedError();
}

const ALL_PERMISSION_KEYS: PermissionKey[] = Object.values(PERMISSIONS);

/**
 * "Super Administrator" (master prompt section 9's override role), defined
 * as holding every permission in the catalogue — the same bar the seeded
 * Amr account meets (32/32). This is deliberately NOT its own separate
 * permission key: a super admin is a user who has been granted everything
 * through the normal admin UI, not a hidden flag that could drift out of
 * sync with what they can actually do. Used only to gate the self-approval
 * override (see requesterMayApprove below) — never as a general-purpose
 * "is this user special" check.
 */
export function isSuperAdmin(user: AuthedUser | null): boolean {
  if (!user) return false;
  return ALL_PERMISSION_KEYS.every((key) => user.permissions.has(key));
}

/**
 * The requester-vs-approver rule from the master prompt section 9: a user
 * normally cannot approve/reject their own request, even if they hold the
 * relevant approve permission. Only a super admin may override this, and
 * every caller that honors `allowed=true` with `isOverride=true` MUST
 * record that fact in the audit entry for the decision (see
 * src/server/approvals/decide.ts for the canonical example) — an
 * unlogged self-approval is exactly what this function exists to prevent.
 */
export function requesterMayApprove(
  decider: AuthedUser | null,
  requesterId: string | null,
): { allowed: boolean; isOverride: boolean } {
  if (!decider) return { allowed: false, isOverride: false };
  if (requesterId === null || requesterId !== decider.id) {
    return { allowed: true, isOverride: false };
  }
  return { allowed: isSuperAdmin(decider), isOverride: true };
}
