import {
  pgTable,
  uuid,
  text,
  timestamp,
  numeric,
  integer,
  boolean,
  date,
  index,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { quoteStatusEnum, quoteLanguageEnum } from "./enums";
import { customers } from "./customers";
import { jobs } from "./jobs";
import { users } from "./auth";
import { workTypes } from "./lookups";

/**
 * A quote "shell". The actual content (items/prices/terms) lives in
 * quoteVersions — quotes itself only tracks identity, current status, and
 * which version (if any) is the immutable signed one.
 */
export const quotes = pgTable(
  "quotes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    quoteNumber: text("quote_number").notNull().unique(), // Q-2026-0001
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    jobId: uuid("job_id")
      .notNull()
      .references((): AnyPgColumn => jobs.id, { onDelete: "cascade" }),
    status: quoteStatusEnum("status").notNull().default("draft"),
    // Document language for the PDF + public signing page (Hebrew
    // signing-flow support, built alongside the AI quote-draft feature).
    // Does not affect the internal app UI, which stays Arabic/RTL.
    language: quoteLanguageEnum("language").notNull().default("ar"),
    // Pointers into quoteVersions, set by application logic — never edited
    // to "fix" a signed version; see quoteVersions doc comment below.
    currentVersionId: uuid("current_version_id").references(
      (): AnyPgColumn => quoteVersions.id,
      { onDelete: "set null" },
    ),
    signedVersionId: uuid("signed_version_id").references(
      (): AnyPgColumn => quoteVersions.id,
      { onDelete: "set null" },
    ),
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
    index("quotes_customer_idx").on(t.customerId),
    index("quotes_job_idx").on(t.jobId),
  ],
);

/**
 * QUOTE VERSION PROTECTION (section 19) — THE most important invariant in
 * this schema. A row here is written once and never updated by application
 * code after creation, with exactly one exception: quoteSignatures may be
 * attached to it at the moment of signing (a 1:1 insert, not an update of
 * this table). Any material change (price/items/quantity/terms) after a
 * quote has been sent — and ESPECIALLY after it's signed — must produce a
 * brand new row here with versionNumber + 1, never a mutation of this one.
 * Enforce this in src/server/quotes/versions.ts, not just by convention.
 */
export const quoteVersions = pgTable(
  "quote_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => quotes.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    paymentTerms: text("payment_terms"),
    workTerms: text("work_terms"),
    notes: text("notes"),
    validUntil: date("valid_until"),
    subtotal: numeric("subtotal", { precision: 12, scale: 2 }).notNull(),
    total: numeric("total", { precision: 12, scale: 2 }).notNull(),
    isSigned: boolean("is_signed").notNull().default(false),
    // AI quote-drafting (draft-assist only, never auto-send — see
    // src/server/ai/). Set on the version created from an AI-drafted quote
    // that a human then reviewed and explicitly saved through the normal
    // Quote Builder flow; the AI itself never writes to this table.
    isAiGenerated: boolean("is_ai_generated").notNull().default(false),
    // The admin's free-text job-description input that produced the AI
    // draft this version was built from. Null for a manually-built version,
    // or an AI-assisted one where the admin heavily rewrote everything.
    aiPromptNotes: text("ai_prompt_notes"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("quote_versions_quote_idx").on(t.quoteId)],
);

/** Line items snapshot for one immutable quote version. */
export const quoteItems = pgTable(
  "quote_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    quoteVersionId: uuid("quote_version_id")
      .notNull()
      .references(() => quoteVersions.id, { onDelete: "cascade" }),
    workTypeId: uuid("work_type_id").references(() => workTypes.id, {
      onDelete: "set null",
    }),
    description: text("description").notNull(),
    quantity: numeric("quantity", { precision: 10, scale: 2 }).notNull(),
    unit: text("unit"),
    unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull(),
    lineTotal: numeric("line_total", { precision: 12, scale: 2 }).notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("quote_items_version_idx").on(t.quoteVersionId)],
);

/**
 * The customer's electronic signature for one quote version (section 18).
 * One row per version (a version can be signed at most once). Everything
 * here is a snapshot of what the customer submitted "at signing time" —
 * never overwritten, even if the customer's master record later changes.
 */
export const quoteSignatures = pgTable("quote_signatures", {
  id: uuid("id").primaryKey().defaultRandom(),
  quoteVersionId: uuid("quote_version_id")
    .notNull()
    .unique()
    .references(() => quoteVersions.id, { onDelete: "cascade" }),
  signedAt: timestamp("signed_at", { withTimezone: true }).notNull(),
  customerNameAtSigning: text("customer_name_at_signing").notNull(),
  customerPhoneAtSigning: text("customer_phone_at_signing"),
  customerNationalIdAtSigning: text("customer_national_id_at_signing"),
  customerAddressAtSigning: text("customer_address_at_signing"),
  latitude: numeric("latitude", { precision: 10, scale: 7 }),
  longitude: numeric("longitude", { precision: 10, scale: 7 }),
  agreedToTerms: boolean("agreed_to_terms").notNull(),
  signatureImage: text("signature_image").notNull(), // base64 PNG data URL
  ipAddress: text("ip_address"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Secure public link a customer can open without an employee account
 * (section 18/75). `token` is a long random opaque string (see
 * src/server/tokens.ts) — never the quote/job's own id.
 */
export const quotePublicLinks = pgTable(
  "quote_public_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => quotes.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true }),
  },
  (t) => [index("quote_public_links_token_idx").on(t.token)],
);
