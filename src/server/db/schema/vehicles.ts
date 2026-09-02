import {
  pgTable,
  uuid,
  text,
  timestamp,
  numeric,
  boolean,
  date,
  integer,
  index,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { fuelTypeEnum } from "./enums";
import { users } from "./auth";

export const vehicles = pgTable("vehicles", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  plateNumber: text("plate_number").notNull().unique(),
  fuelType: fuelTypeEnum("fuel_type").notNull().default("petrol"),
  // Current default responsible user. Full history lives in
  // vehicleResponsibilityHistory below — this column is a convenience
  // pointer to "whoever the current open history row says", kept in sync
  // by the responsibility-assignment service, not edited directly.
  defaultResponsibleUserId: uuid("default_responsible_user_id").references(
    (): AnyPgColumn => users.id,
    { onDelete: "set null" },
  ),
  estimatedValue: numeric("estimated_value", { precision: 12, scale: 2 }),
  isActive: boolean("is_active").notNull().default(true),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * History of who was responsible for a vehicle over time (section 57).
 * `endDate` null means "current". Do not overwrite past rows — close one
 * (set endDate) and insert a new one when responsibility changes.
 */
export const vehicleResponsibilityHistory = pgTable(
  "vehicle_responsibility_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    startDate: date("start_date").notNull(),
    endDate: date("end_date"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("vehicle_resp_history_vehicle_idx").on(t.vehicleId)],
);

/**
 * Fast fuel entry (section 56). `addedByUserId` (who bought/logged it) is
 * deliberately separate from the vehicle's responsible user, so management
 * can always tell "who purchased fuel" apart from "who is responsible for
 * this vehicle".
 */
export const fuelLogs = pgTable(
  "fuel_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "restrict" }),
    addedByUserId: uuid("added_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    fuelType: fuelTypeEnum("fuel_type").notNull(),
    liters: numeric("liters", { precision: 8, scale: 2 }),
    mileage: integer("mileage"),
    receiptPhotoTaken: boolean("receipt_photo_taken").notNull().default(false),
    notes: text("notes"),
    loggedAt: timestamp("logged_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("fuel_logs_vehicle_idx").on(t.vehicleId),
    index("fuel_logs_logged_at_idx").on(t.loggedAt),
  ],
);
