import { pgTable, uuid, text, timestamp, date, index } from "drizzle-orm/pg-core";
import { repairStatusEnum } from "./enums";
import { jobs } from "./jobs";
import { users } from "./auth";

/**
 * Repairs / Tikun (section 50). Every unresolved row here must surface on
 * the management dashboard — see src/server/dashboard/needs-attention.ts —
 * so a job with open repair work can never quietly fall off the radar.
 */
export const repairs = pgTable(
  "repairs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    problemDescription: text("problem_description").notNull(),
    dateReported: date("date_reported").notNull(),
    responsibleUserId: uuid("responsible_user_id").references(
      () => users.id,
      { onDelete: "set null" },
    ),
    scheduledDate: date("scheduled_date"),
    status: repairStatusEnum("status").notNull().default("open"),
    notes: text("notes"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("repairs_job_idx").on(t.jobId),
    index("repairs_status_idx").on(t.status),
  ],
);
