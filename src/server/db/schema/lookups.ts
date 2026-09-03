import {
  pgTable,
  uuid,
  text,
  timestamp,
  numeric,
  boolean,
  integer,
  jsonb,
  primaryKey,
} from "drizzle-orm/pg-core";
import { users } from "./auth";

/**
 * Admin-configurable operational statuses (section 13). Jobs reference
 * this table by id, never a hardcoded string, so adding/renaming/reordering
 * a status is a Settings-screen edit, not a code change.
 */
export const jobStatuses = pgTable("job_statuses", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(),
  labelEn: text("label_en").notNull(),
  labelAr: text("label_ar").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  isTerminal: boolean("is_terminal").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  color: text("color"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Configurable work/glass-item types (section 21/23). Shared by job_items,
 * quote_items and compensation_rules so "Shower", "Railing", etc. are
 * defined once and reused everywhere.
 */
export const workTypes = pgTable("work_types", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(),
  labelEn: text("label_en").notNull(),
  labelAr: text("label_ar").notNull(),
  defaultUnit: text("default_unit").notNull().default("unit"),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
});

/**
 * Admin-editable glass-type lookup for the New Measurement quick-submit
 * flow (docs/superpowers/specs/2026-09-03-new-measurement-quick-submit-design.md
 * section 4) — same shape and conventions as `workTypes` above, extended
 * via the same Settings lookups CRUD pattern (src/server/lookups/actions.ts)
 * rather than a separate one-off. Referenced from `measurements.glassTypeId`.
 */
export const glassTypes = pgTable("glass_types", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(),
  labelEn: text("label_en").notNull(),
  labelAr: text("label_ar").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
});

/**
 * Configurable installer compensation rates (section 23), e.g. "Glass
 * Railing: 250 ILS / meter". Never hardcode these amounts in application
 * code — always look them up here so Settings can edit them.
 */
export const compensationRules = pgTable("compensation_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  workTypeId: uuid("work_type_id").references(() => workTypes.id, {
    onDelete: "set null",
  }),
  label: text("label").notNull(),
  unit: text("unit").notNull().default("unit"), // meter | unit | job | day
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Configurable penalty rules (section 30), e.g. "Late to Customer: 100/hr". */
export const penaltyRules = pgTable("penalty_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  label: text("label").notNull(),
  defaultAmount: numeric("default_amount", {
    precision: 12,
    scale: 2,
  }).notNull(),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Configurable bonus rules (section 31). */
export const bonusRules = pgTable("bonus_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  label: text("label").notNull(),
  defaultAmount: numeric("default_amount", {
    precision: 12,
    scale: 2,
  }).notNull(),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Human-readable document numbering (section 80), e.g. JOB-2026-0001.
 * One row per (scope, year); incremented inside a transaction using
 * SELECT ... FOR UPDATE so two concurrent creations never collide.
 */
export const numberSequences = pgTable(
  "number_sequences",
  {
    scope: text("scope").notNull(), // 'job' | 'quote' | 'production_request'
    year: integer("year").notNull(),
    lastValue: integer("last_value").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.scope, t.year] })],
);

/**
 * Generic key/value store for adjustable business rules that don't need
 * their own table (section 77): commission %, quote validity days,
 * vehicle-usage-deduction default, notification thresholds, company info
 * shown on quotes, default quote/work terms, etc. Typed accessors live in
 * src/server/settings.ts — nothing in the app reads process.env or a
 * hardcoded constant for a value that belongs here.
 */
export const applicationSettings = pgTable("application_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedByUserId: uuid("updated_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
});
