import "server-only";
import { and, count, desc, eq, ilike, isNull, or } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  quotes,
  quoteVersions,
  quoteItems,
  quoteSignatures,
  quotePublicLinks,
  customers,
  jobs,
  workTypes,
} from "@/server/db/schema";

async function getVersionItems(quoteVersionId: string) {
  return db
    .select({
      id: quoteItems.id,
      workTypeId: quoteItems.workTypeId,
      workTypeLabelAr: workTypes.labelAr,
      description: quoteItems.description,
      quantity: quoteItems.quantity,
      unit: quoteItems.unit,
      unitPrice: quoteItems.unitPrice,
      lineTotal: quoteItems.lineTotal,
    })
    .from(quoteItems)
    .leftJoin(workTypes, eq(quoteItems.workTypeId, workTypes.id))
    .where(eq(quoteItems.quoteVersionId, quoteVersionId))
    .orderBy(quoteItems.sortOrder);
}

/** The one quote thread for a job (a job has at most one, versioned over
 * time — see the doc comment on createQuoteVersion), with its current
 * version's full content and any outstanding public link. Null if the job
 * has never had a quote started. */
export async function getQuoteForJob(jobId: string) {
  const [quote] = await db
    .select()
    .from(quotes)
    .where(eq(quotes.jobId, jobId))
    .orderBy(desc(quotes.createdAt))
    .limit(1);
  if (!quote) return null;

  const [currentVersionRow, activeLinkRow, versionHistory] = await Promise.all([
    quote.currentVersionId
      ? db
          .select()
          .from(quoteVersions)
          .where(eq(quoteVersions.id, quote.currentVersionId))
          .limit(1)
          .then((r) => r[0] ?? null)
      : Promise.resolve(null),
    db
      .select()
      .from(quotePublicLinks)
      .where(
        and(eq(quotePublicLinks.quoteId, quote.id), isNull(quotePublicLinks.revokedAt)),
      )
      .orderBy(desc(quotePublicLinks.createdAt))
      .limit(1)
      .then((r) => r[0] ?? null),
    db
      .select({
        id: quoteVersions.id,
        versionNumber: quoteVersions.versionNumber,
        createdAt: quoteVersions.createdAt,
        isSigned: quoteVersions.isSigned,
        total: quoteVersions.total,
      })
      .from(quoteVersions)
      .where(eq(quoteVersions.quoteId, quote.id))
      .orderBy(desc(quoteVersions.versionNumber)),
  ]);

  const items = currentVersionRow ? await getVersionItems(currentVersionRow.id) : [];
  const now = new Date();
  const isExpired = Boolean(
    currentVersionRow?.validUntil &&
      !currentVersionRow.isSigned &&
      new Date(currentVersionRow.validUntil) < now,
  );

  return {
    ...quote,
    currentVersion: currentVersionRow ? { ...currentVersionRow, items } : null,
    activeLink: activeLinkRow,
    versionHistory,
    isExpired,
  };
}

export type QuoteForJob = NonNullable<Awaited<ReturnType<typeof getQuoteForJob>>>;

/** Public signing page lookup — the token IS the security boundary here, no
 * permission check applies (section 18/75). Returns null for any token that
 * doesn't resolve to a usable link at all; the page itself distinguishes
 * revoked/expired/already-signed via the fields on the result. */
export async function getQuoteByPublicToken(token: string) {
  const [link] = await db
    .select()
    .from(quotePublicLinks)
    .where(eq(quotePublicLinks.token, token))
    .limit(1);
  if (!link) return null;

  const [quote] = await db
    .select()
    .from(quotes)
    .where(eq(quotes.id, link.quoteId))
    .limit(1);
  if (!quote || !quote.currentVersionId) return null;

  const [version] = await db
    .select()
    .from(quoteVersions)
    .where(eq(quoteVersions.id, quote.currentVersionId))
    .limit(1);
  if (!version) return null;

  const [customerRow] = await db
    .select()
    .from(customers)
    .where(eq(customers.id, quote.customerId))
    .limit(1);
  const [jobRow] = await db
    .select({ jobNumber: jobs.jobNumber, title: jobs.title, address: jobs.address })
    .from(jobs)
    .where(eq(jobs.id, quote.jobId))
    .limit(1);

  const [items, signature] = await Promise.all([
    getVersionItems(version.id),
    version.isSigned
      ? db
          .select()
          .from(quoteSignatures)
          .where(eq(quoteSignatures.quoteVersionId, version.id))
          .limit(1)
          .then((r) => r[0] ?? null)
      : Promise.resolve(null),
  ]);

  const now = new Date();
  const isExpired = Boolean(
    version.validUntil && !version.isSigned && new Date(version.validUntil) < now,
  );

  return {
    link,
    quote,
    version: { ...version, items },
    customer: customerRow ?? null,
    job: jobRow ?? null,
    signature,
    isRevoked: link.revokedAt !== null,
    isExpired,
  };
}

export type PublicQuote = NonNullable<Awaited<ReturnType<typeof getQuoteByPublicToken>>>;

export async function touchPublicLinkAccess(token: string): Promise<void> {
  await db
    .update(quotePublicLinks)
    .set({ lastAccessedAt: new Date() })
    .where(eq(quotePublicLinks.token, token));
}

/** Everything the PDF template (src/server/pdf/quote-template.ts) needs for
 * one quote, keyed by quoteId — used by the internal, permission-gated PDF
 * route. (The public PDF route uses getQuoteByPublicToken instead, since
 * it has no employee session to key off of and must validate the link
 * itself.)
 *
 * Renders quote.signedVersionId when one exists, quote.currentVersionId
 * otherwise — NOT unconditionally currentVersionId. A signed document must
 * always render exactly as signed (master prompt: "never modify
 * historical signed data"); once a later price edit creates a new current
 * draft (quotes.status resets to 'draft', currentVersionId moves forward,
 * signedVersionId never does), this route used to silently switch to
 * showing that new, unsigned draft under the same "quote's official PDF"
 * link — an employee opening what they believe is the customer's signed
 * contract would see different numbers with no indication of the
 * mismatch. A staff member who specifically wants to preview the new,
 * unsent draft can do so through the quote builder dialog itself. */
export async function getQuoteRenderData(quoteId: string) {
  const [quote] = await db.select().from(quotes).where(eq(quotes.id, quoteId)).limit(1);
  const versionIdToRender = quote?.signedVersionId ?? quote?.currentVersionId;
  if (!quote || !versionIdToRender) return null;

  const [version] = await db
    .select()
    .from(quoteVersions)
    .where(eq(quoteVersions.id, versionIdToRender))
    .limit(1);
  if (!version) return null;

  const [customer, job, items, signature] = await Promise.all([
    db.select().from(customers).where(eq(customers.id, quote.customerId)).limit(1).then((r) => r[0] ?? null),
    db
      .select({ jobNumber: jobs.jobNumber, title: jobs.title })
      .from(jobs)
      .where(eq(jobs.id, quote.jobId))
      .limit(1)
      .then((r) => r[0] ?? null),
    getVersionItems(version.id),
    version.isSigned
      ? db
          .select()
          .from(quoteSignatures)
          .where(eq(quoteSignatures.quoteVersionId, version.id))
          .limit(1)
          .then((r) => r[0] ?? null)
      : Promise.resolve(null),
  ]);

  return { quote, version: { ...version, items }, customer, job, signature };
}

export type QuoteStatus = "draft" | "sent" | "signed" | "expired" | "superseded";
const QUOTE_STATUSES: readonly QuoteStatus[] = [
  "draft",
  "sent",
  "signed",
  "expired",
  "superseded",
];
export function isQuoteStatus(value: string): value is QuoteStatus {
  return (QUOTE_STATUSES as readonly string[]).includes(value);
}

export interface ListQuotesParams {
  search?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export interface QuoteListRow {
  id: string;
  quoteNumber: string;
  jobId: string;
  jobNumber: string;
  customerName: string;
  status: string;
  total: string | null;
  createdAt: Date;
}

/** Cross-job quote list for the /quotes list page (nav already gates it on
 * CREATE_QUOTE, SEND_QUOTE, CLOSE_DEAL, or VIEW_ALL_JOBS) — no per-row
 * job-involvement restriction, same posture as listProductionRequests:
 * holding any one of those permissions means seeing every quote, not just
 * "your own" jobs. */
export async function listQuotes(
  params: ListQuotesParams,
): Promise<{ rows: QuoteListRow[]; total: number }> {
  const { search, status, limit = 25, offset = 0 } = params;

  const conditions = [];
  const term = search?.trim();
  if (term) {
    const pattern = `%${term}%`;
    conditions.push(
      or(
        ilike(quotes.quoteNumber, pattern),
        ilike(jobs.jobNumber, pattern),
        ilike(customers.name, pattern),
      )!,
    );
  }
  if (status && isQuoteStatus(status)) {
    conditions.push(eq(quotes.status, status));
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, [{ value: total }]] = await Promise.all([
    db
      .select({
        id: quotes.id,
        quoteNumber: quotes.quoteNumber,
        jobId: quotes.jobId,
        jobNumber: jobs.jobNumber,
        customerName: customers.name,
        status: quotes.status,
        total: quoteVersions.total,
        createdAt: quotes.createdAt,
      })
      .from(quotes)
      .innerJoin(jobs, eq(quotes.jobId, jobs.id))
      .innerJoin(customers, eq(quotes.customerId, customers.id))
      .leftJoin(quoteVersions, eq(quotes.currentVersionId, quoteVersions.id))
      .where(where)
      .orderBy(desc(quotes.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ value: count() })
      .from(quotes)
      .innerJoin(jobs, eq(quotes.jobId, jobs.id))
      .innerJoin(customers, eq(quotes.customerId, customers.id))
      .where(where),
  ]);

  return { rows, total };
}
