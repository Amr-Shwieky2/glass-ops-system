import {
  pgTable,
  uuid,
  text,
  timestamp,
  numeric,
  date,
  index,
} from "drizzle-orm/pg-core";
import { factoryStatusEnum, approvalStatusEnum } from "./enums";
import { jobs } from "./jobs";
import { users } from "./auth";

/** Created from a Job to send everything the factory needs (section 43). */
export const productionRequests = pgTable(
  "production_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Sprint 7 (R1.51): human-readable number, e.g. PR-2026-0001 — the
    // "PR" prefix and nextDocumentNumber("production_request", ...)
    // machinery already existed (src/server/numbering.ts) but nothing
    // ever called it; every request was identified only by its uuid.
    requestNumber: text("request_number").notNull().unique(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    requestedByUserId: uuid("requested_by_user_id").references(
      () => users.id,
      { onDelete: "set null" },
    ),
    details: text("details"),
    status: factoryStatusEnum("status").notNull().default("pending"),
    estimatedReadyDate: date("estimated_ready_date"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("production_requests_job_idx").on(t.jobId)],
);

/**
 * What the factory submitted via its public link (section 44/45). Only
 * once approvalStatus flips to 'approved' does submittedPrice become an
 * official jobCosts row — see src/server/production/approve.ts.
 */
export const factorySubmissions = pgTable(
  "factory_submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productionRequestId: uuid("production_request_id")
      .notNull()
      .references(() => productionRequests.id, { onDelete: "cascade" }),
    submittedPrice: numeric("submitted_price", {
      precision: 12,
      scale: 2,
    }).notNull(),
    notes: text("notes"),
    estimatedReadyDate: date("estimated_ready_date"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull(),
    approvalStatus: approvalStatusEnum("approval_status")
      .notNull()
      .default("pending"),
    approvedByUserId: uuid("approved_by_user_id").references(
      () => users.id,
      { onDelete: "set null" },
    ),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    rejectionReason: text("rejection_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("factory_submissions_request_idx").on(t.productionRequestId),
  ],
);

/** Secure public link for the factory (section 43) — no employee account. */
export const factoryPublicLinks = pgTable(
  "factory_public_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productionRequestId: uuid("production_request_id")
      .notNull()
      .references(() => productionRequests.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true }),
  },
  (t) => [index("factory_public_links_token_idx").on(t.token)],
);
