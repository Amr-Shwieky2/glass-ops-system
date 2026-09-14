import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { approvableEntityTypeEnum, approvalStatusEnum } from "./enums";
import { users } from "./auth";
import { jobs } from "./jobs";

/**
 * Reusable approval queue (section 61). This row is the UI/audit trail of
 * the decision; the underlying entity (customerPayments.approvalStatus,
 * technicianLedgerEntries.approvalStatus, factorySubmissions.approvalStatus,
 * jobCosts.status) is flipped inside the SAME transaction as this row's
 * status update — see src/server/approvals/decide.ts. Never approve/reject
 * the underlying entity from anywhere else.
 */
export const approvalRequests = pgTable(
  "approval_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityType: approvableEntityTypeEnum("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    requestedByUserId: uuid("requested_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    requestedAt: timestamp("requested_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    status: approvalStatusEnum("status").notNull().default("pending"),
    decidedByUserId: uuid("decided_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    rejectionReason: text("rejection_reason"),
    summary: text("summary").notNull(),
    relatedJobId: uuid("related_job_id").references(() => jobs.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("approval_requests_status_idx").on(t.status),
    index("approval_requests_entity_idx").on(t.entityType, t.entityId),
  ],
);

/** In-app notifications (section 63) — free, no SMS/push provider. */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    relatedEntityType: text("related_entity_type"),
    relatedEntityId: uuid("related_entity_id"),
    isRead: boolean("is_read").notNull().default(false),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("notifications_user_idx").on(t.userId),
    index("notifications_user_unread_idx").on(t.userId, t.isRead),
  ],
);

/**
 * Immutable audit trail (section 62). Application code only ever INSERTs
 * here — no service function updates or deletes a row. For extra
 * hardening in a hand-rolled production deployment, consider REVOKE UPDATE,
 * DELETE ON audit_logs FROM the app's runtime DB role (see README security
 * notes) so this holds even against a compromised app process.
 */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    action: text("action").notNull(), // e.g. 'quote.price_changed'
    entityType: text("entity_type").notNull(),
    // TEXT, not uuid: unlike approval_requests (which only ever points at a
    // real row with a UUID id), the audit trail also covers entities with
    // no UUID of their own — e.g. settings-actions.ts audits an
    // application_settings change keyed by its text `key` column
    // ("commission_rate_percent"), which a uuid column rejects outright.
    entityId: text("entity_id").notNull(),
    oldValue: jsonb("old_value"),
    newValue: jsonb("new_value"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("audit_logs_entity_idx").on(t.entityType, t.entityId),
    index("audit_logs_created_at_idx").on(t.createdAt),
  ],
);

/**
 * Idempotency/duplicate-prevention ledger for the scheduled-notification
 * worker (Sprint 4, src/server/scheduler/). A scheduled condition (e.g.
 * "installation appointment starts within the reminder window") is
 * re-evaluated on every scheduler tick, so without this table the same
 * appointment/quote/check/repair/job would get re-notified every tick
 * forever. Before sending any scheduled reminder, the worker atomically
 * claims the (triggerType, relatedEntityId) pair here via
 * `.onConflictDoNothing()` — only the tick whose INSERT actually returns a
 * row (i.e. no prior row existed) proceeds to notify; every other
 * concurrent or later tick sees the conflict and skips, race-safely
 * (a SELECT-then-INSERT check would have a TOCTOU race between two
 * overlapping ticks; the unique constraint below is what actually makes
 * this safe). One row = one trigger firing exactly once, ever, for that
 * entity — matching "duplicate prevention" rather than "at most once per
 * day" or similar, since every trigger type here targets a specific,
 * non-repeating real-world moment (this appointment's start time, this
 * quote being sent, ...), not a recurring condition.
 */
export const scheduledReminders = pgTable(
  "scheduled_reminders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    triggerType: text("trigger_type").notNull(),
    relatedEntityId: uuid("related_entity_id").notNull(),
    firedAt: timestamp("fired_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("scheduled_reminders_trigger_entity_idx").on(
      t.triggerType,
      t.relatedEntityId,
    ),
  ],
);
