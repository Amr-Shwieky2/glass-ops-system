import { describe, it, expect } from "vitest";
import {
  can,
  canAny,
  requirePermission,
  requireAnyPermission,
  requireUser,
  ForbiddenError,
  UnauthenticatedError,
} from "@/server/auth/permissions";
import { PERMISSIONS } from "@/server/auth/permission-keys";
import type { AuthedUser } from "@/server/auth/session";

/**
 * This is the single authorization choke-point for the entire app (every
 * mutating Server Action calls can()/canAny()/requirePermission() before
 * any DB write — AGENTS.md) — tested thoroughly, and deliberately never by
 * branching on name/id, only on the permission set.
 */
function makeUser(permissions: string[]): AuthedUser {
  return {
    id: "user-1",
    name: "Test User",
    phone: "0501111111",
    email: null,
    status: "active",
    defaultVehicleId: null,
    dailyWageAmount: null,
    permissions: new Set(permissions),
  };
}

const noPermsUser = makeUser([]);
const exactUser = makeUser([PERMISSIONS.MANAGE_USERS]);
const unrelatedUser = makeUser([PERMISSIONS.VIEW_CUSTOMERS, PERMISSIONS.ADD_FUEL]);
const severalIncludingUser = makeUser([
  PERMISSIONS.VIEW_CUSTOMERS,
  PERMISSIONS.MANAGE_USERS,
  PERMISSIONS.ADD_FUEL,
]);

describe("can", () => {
  it("returns false for a null user regardless of permission", () => {
    expect(can(null, PERMISSIONS.MANAGE_USERS)).toBe(false);
  });

  it("returns false for a user with no permissions", () => {
    expect(can(noPermsUser, PERMISSIONS.MANAGE_USERS)).toBe(false);
  });

  it("returns false for a user with only unrelated permissions", () => {
    expect(can(unrelatedUser, PERMISSIONS.MANAGE_USERS)).toBe(false);
  });

  it("returns true for a user with exactly the required permission", () => {
    expect(can(exactUser, PERMISSIONS.MANAGE_USERS)).toBe(true);
  });

  it("returns true for a user with several permissions including the required one", () => {
    expect(can(severalIncludingUser, PERMISSIONS.MANAGE_USERS)).toBe(true);
  });

  it("never authorizes based on user identity, only the permission set", () => {
    // Two different users, same permission set: same result. Nothing in
    // can() may look at .id or .name (AGENTS.md: "NEVER branch on a
    // user's name/id for authorization").
    const superAdminNamedUser = { ...noPermsUser, id: "super-admin-id", name: "Amr" };
    expect(can(superAdminNamedUser, PERMISSIONS.MANAGE_USERS)).toBe(false);
  });
});

describe("canAny", () => {
  it("returns false for a null user", () => {
    expect(canAny(null, [PERMISSIONS.MANAGE_USERS, PERMISSIONS.VIEW_CUSTOMERS])).toBe(false);
  });

  it("returns false when the user has none of the listed permissions", () => {
    expect(canAny(unrelatedUser, [PERMISSIONS.MANAGE_USERS, PERMISSIONS.CREATE_QUOTE])).toBe(
      false,
    );
  });

  it("returns true when the user has at least one of the listed permissions", () => {
    expect(canAny(unrelatedUser, [PERMISSIONS.MANAGE_USERS, PERMISSIONS.VIEW_CUSTOMERS])).toBe(
      true,
    );
  });

  it("returns false for an empty permission list", () => {
    expect(canAny(exactUser, [])).toBe(false);
  });
});

describe("requirePermission", () => {
  it("throws UnauthenticatedError for a null user", () => {
    expect(() => requirePermission(null, PERMISSIONS.MANAGE_USERS)).toThrow(
      UnauthenticatedError,
    );
  });

  it("throws ForbiddenError for a user missing the permission", () => {
    expect(() => requirePermission(noPermsUser, PERMISSIONS.MANAGE_USERS)).toThrow(
      ForbiddenError,
    );
    expect(() => requirePermission(unrelatedUser, PERMISSIONS.MANAGE_USERS)).toThrow(
      ForbiddenError,
    );
  });

  it("includes the missing permission key in the error message", () => {
    try {
      requirePermission(noPermsUser, PERMISSIONS.MANAGE_USERS);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenError);
      expect((err as Error).message).toContain(PERMISSIONS.MANAGE_USERS);
    }
  });

  it("does not throw for a user with the exact permission", () => {
    expect(() => requirePermission(exactUser, PERMISSIONS.MANAGE_USERS)).not.toThrow();
  });

  it("does not throw for a user with several permissions including the required one", () => {
    expect(() =>
      requirePermission(severalIncludingUser, PERMISSIONS.MANAGE_USERS),
    ).not.toThrow();
  });
});

describe("requireAnyPermission", () => {
  it("throws UnauthenticatedError for a null user", () => {
    expect(() => requireAnyPermission(null, [PERMISSIONS.MANAGE_USERS])).toThrow(
      UnauthenticatedError,
    );
  });

  it("throws ForbiddenError when the user has none of the listed permissions", () => {
    expect(() =>
      requireAnyPermission(unrelatedUser, [PERMISSIONS.MANAGE_USERS, PERMISSIONS.CREATE_QUOTE]),
    ).toThrow(ForbiddenError);
  });

  it("does not throw when the user has at least one of the listed permissions", () => {
    expect(() =>
      requireAnyPermission(unrelatedUser, [PERMISSIONS.MANAGE_USERS, PERMISSIONS.VIEW_CUSTOMERS]),
    ).not.toThrow();
  });
});

describe("requireUser", () => {
  it("throws UnauthenticatedError for a null user", () => {
    expect(() => requireUser(null)).toThrow(UnauthenticatedError);
  });

  it("does not throw for any logged-in user, even with zero permissions", () => {
    expect(() => requireUser(noPermsUser)).not.toThrow();
  });
});
