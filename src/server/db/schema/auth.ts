import {
  pgTable,
  uuid,
  text,
  timestamp,
  numeric,
  primaryKey,
  index,
} from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { userStatusEnum } from "./enums";
import { vehicles } from "./vehicles";

/**
 * Every system user. Login identifier is `phone` (normalized E.164-ish,
 * e.g. +972501234567), not email — email is optional per the spec.
 *
 * IMPORTANT: nothing in the application may branch on `name` or `phone`.
 * All authorization goes through the permissions/userPermissions tables
 * via the `can()` helper in src/server/auth/permissions.ts.
 */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    phone: text("phone").notNull().unique(),
    email: text("email").unique(),
    passwordHash: text("password_hash").notNull(),
    status: userStatusEnum("status").notNull().default("active"),
    // Nullable FK to vehicles; vehicles.default_responsible_user_id points
    // back at users, so this pair is intentionally circular — both sides
    // are nullable and drizzle-kit orders the ALTER TABLE ADD CONSTRAINT
    // statements after both tables exist.
    defaultVehicleId: uuid("default_vehicle_id").references(
      (): AnyPgColumn => vehicles.id,
      { onDelete: "set null" },
    ),
    // Only meaningful for fixed daily-wage workers (section 27). Nullable —
    // most users are not on a daily wage.
    dailyWageAmount: numeric("daily_wage_amount", { precision: 12, scale: 2 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("users_phone_idx").on(t.phone)],
);

/**
 * The full permission catalogue. `key` is a stable slug referenced directly
 * by application code constants (see src/server/auth/permission-keys.ts) —
 * never by employee name. Seeded once; admins toggle grants per-user via
 * user_permissions, they do not edit this catalogue in V1.
 */
export const permissions = pgTable("permissions", {
  key: text("key").primaryKey(),
  label: text("label").notNull(),
  description: text("description"),
  category: text("category").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Independently assignable grants: which user has which permission. */
export const userPermissions = pgTable(
  "user_permissions",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    permissionKey: text("permission_key")
      .notNull()
      .references(() => permissions.key, { onDelete: "cascade" }),
    grantedAt: timestamp("granted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    grantedByUserId: uuid("granted_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.permissionKey] })],
);

/**
 * Server-side session store for the custom cookie-based auth (no NextAuth).
 * The httpOnly cookie holds a random raw token; only its SHA-256 hash is
 * stored here, so a leaked database row can't be replayed as a cookie.
 */
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    userAgent: text("user_agent"),
    ipAddress: text("ip_address"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);
