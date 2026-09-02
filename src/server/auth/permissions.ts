import "server-only";
import type { AuthedUser } from "./session";
import type { PermissionKey } from "./permission-keys";

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
