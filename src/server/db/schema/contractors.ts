import { pgTable, uuid, text, boolean, timestamp } from "drizzle-orm/pg-core";

/**
 * External people/companies (aluminum installer, external glazier, etc. —
 * section 49). Deliberately just a lightweight master profile: which job
 * a contractor worked on is captured by jobAssignments, and what they were
 * paid is captured by jobCosts — not duplicated here. Not a full supplier
 * ERP by design (V1 non-goal, section 49/89).
 */
export const externalContractors = pgTable("external_contractors", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  phone: text("phone"),
  serviceType: text("service_type"),
  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
