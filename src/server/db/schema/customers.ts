import {
  pgTable,
  uuid,
  text,
  timestamp,
  numeric,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./auth";

/**
 * One reusable profile per customer (section 9). Every job/quote/payment
 * references this row — customer details are entered exactly once.
 */
export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    phone: text("phone").notNull(),
    nationalId: text("national_id"),
    address: text("address"),
    googleMapsUrl: text("google_maps_url"),
    latitude: numeric("latitude", { precision: 10, scale: 7 }),
    longitude: numeric("longitude", { precision: 10, scale: 7 }),
    notes: text("notes"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("customers_name_idx").on(t.name),
    index("customers_phone_idx").on(t.phone),
    // Enforces "at most one active customer per phone number" at the
    // database level (partial — excludes soft-deleted rows, so a phone
    // freed up by a soft delete can be reused by a genuinely new
    // customer). Without this, two concurrent find-or-create-by-phone
    // submissions (e.g. two technicians independently visiting the same
    // customer via the New Measurement quick-submit flow, see
    // src/server/measurements/actions.ts) can both pass the "does this
    // phone already have a customer?" check before either commits its
    // insert, producing two customer rows for one phone number. With
    // this index, the loser's INSERT no-ops (onConflictDoNothing) instead
    // of creating a duplicate.
    uniqueIndex("customers_phone_active_unique_idx")
      .on(t.phone)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);
