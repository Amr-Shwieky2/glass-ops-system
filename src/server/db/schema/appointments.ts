import {
  pgTable,
  uuid,
  text,
  timestamp,
  primaryKey,
  index,
} from "drizzle-orm/pg-core";
import { appointmentTypeEnum, appointmentStatusEnum } from "./enums";
import { jobs } from "./jobs";
import { users } from "./auth";

/** Calendar events (section 40/41), always tied to a Job. */
export const appointments = pgTable(
  "appointments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    type: appointmentTypeEnum("type").notNull(),
    scheduledStart: timestamp("scheduled_start", {
      withTimezone: true,
    }).notNull(),
    scheduledEnd: timestamp("scheduled_end", { withTimezone: true }),
    location: text("location"), // defaults to job/customer address in the UI
    status: appointmentStatusEnum("status").notNull().default("scheduled"),
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
  },
  (t) => [
    index("appointments_job_idx").on(t.jobId),
    index("appointments_scheduled_start_idx").on(t.scheduledStart),
  ],
);

/** One or more people assigned to an appointment (section 41). */
export const appointmentAssignees = pgTable(
  "appointment_assignees",
  {
    appointmentId: uuid("appointment_id")
      .notNull()
      .references(() => appointments.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.appointmentId, t.userId] }),
    index("appointment_assignees_user_idx").on(t.userId),
  ],
);
