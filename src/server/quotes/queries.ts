import "server-only";
import { and, desc, eq, isNull } from "drizzle-orm";
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
 * one quote's CURRENT version, keyed by quoteId — used by the internal,
 * permission-gated PDF route. (The public PDF route uses
 * getQuoteByPublicToken instead, since it has no employee session to key
 * off of and must validate the link itself.) */
export async function getQuoteRenderData(quoteId: string) {
  const [quote] = await db.select().from(quotes).where(eq(quotes.id, quoteId)).limit(1);
  if (!quote || !quote.currentVersionId) return null;

  const [version] = await db
    .select()
    .from(quoteVersions)
    .where(eq(quoteVersions.id, quote.currentVersionId))
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
