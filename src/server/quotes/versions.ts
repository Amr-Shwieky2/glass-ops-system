import "server-only";
import { and, eq, isNull, desc } from "drizzle-orm";
import { db } from "@/server/db/client";
import type { Database } from "@/server/db/client";
import {
  quotes,
  quoteVersions,
  quoteItems,
  quotePublicLinks,
} from "@/server/db/schema";
import { nextDocumentNumber } from "@/server/numbering";
import { multiplyMoney, sumMoney, type Money } from "@/server/money";

export interface QuoteItemInput {
  workTypeId?: string;
  description: string;
  quantity: string; // Money-shaped decimal string, e.g. "2.5"
  unit?: string;
  unitPrice: Money;
}

export interface CreateQuoteVersionParams {
  jobId: string;
  customerId: string;
  /** Omit to start a brand-new quote; pass to add a new version to one that
   * already exists (editing a draft, or revising a sent/signed quote). */
  quoteId?: string;
  createdByUserId: string;
  items: QuoteItemInput[];
  paymentTerms?: string;
  workTerms?: string;
  /** ISO date string (yyyy-mm-dd), or omitted for "no expiry" recorded. */
  validUntil?: string;
}

export interface CreateQuoteVersionResult {
  quoteId: string;
  quoteVersionId: string;
  versionNumber: number;
}

/** Today + N days as a yyyy-mm-dd string, for defaulting a new quote's
 * "valid until" date input. A plain helper (not itself a component/hook)
 * so a Server Component computing this for its render stays outside the
 * react-hooks/purity lint rule's reach, which only inspects component and
 * hook function bodies directly — there's no actual purity concern here,
 * this runs once per request on the server, not in a memoized client render. */
export function defaultQuoteValidUntil(validityDays: number): string {
  return new Date(Date.now() + validityDays * 86_400_000).toISOString().slice(0, 10);
}

/**
 * THE ONLY function allowed to write quote_versions rows (section 19). Every
 * quote edit — first draft, later edits, even a post-signature correction —
 * goes through here as a brand new immutable row, never an UPDATE of an
 * existing version. Always runs as its own top-level transaction (no caller
 * in this codebase needs to nest it inside a larger one).
 */
export async function createQuoteVersion(
  params: CreateQuoteVersionParams,
): Promise<CreateQuoteVersionResult> {
  if (params.items.length === 0) {
    throw new Error("لا يمكن حفظ عرض سعر بدون أي بند");
  }

  const run = async (tx: Database): Promise<CreateQuoteVersionResult> => {
    let quoteId = params.quoteId;
    let isNewQuote = false;

    if (!quoteId) {
      const quoteNumber = await nextDocumentNumber("quote", tx);
      const [newQuote] = await tx
        .insert(quotes)
        .values({
          quoteNumber,
          customerId: params.customerId,
          jobId: params.jobId,
          status: "draft",
          createdByUserId: params.createdByUserId,
        })
        .returning({ id: quotes.id });
      quoteId = newQuote.id;
      isNewQuote = true;
    } else {
      // Editing an existing quote thread: whatever public link is out there
      // pointed at the PREVIOUS current version's content — once we write a
      // new version below, that link must stop working, since the page it
      // led to no longer reflects the current terms (section 18/19).
      await tx
        .update(quotePublicLinks)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(quotePublicLinks.quoteId, quoteId),
            isNull(quotePublicLinks.revokedAt),
          ),
        );
    }

    const [lastVersion] = await tx
      .select({ versionNumber: quoteVersions.versionNumber })
      .from(quoteVersions)
      .where(eq(quoteVersions.quoteId, quoteId))
      .orderBy(desc(quoteVersions.versionNumber))
      .limit(1);
    const versionNumber = (lastVersion?.versionNumber ?? 0) + 1;

    const lineTotals = params.items.map((item) =>
      multiplyMoney(item.quantity, item.unitPrice),
    );
    const subtotal = sumMoney(lineTotals);
    const total = subtotal; // no separate tax/discount column in this schema

    const [version] = await tx
      .insert(quoteVersions)
      .values({
        quoteId,
        versionNumber,
        paymentTerms: params.paymentTerms,
        workTerms: params.workTerms,
        validUntil: params.validUntil,
        subtotal,
        total,
        isSigned: false,
        createdByUserId: params.createdByUserId,
      })
      .returning({ id: quoteVersions.id });

    await tx.insert(quoteItems).values(
      params.items.map((item, i) => ({
        quoteVersionId: version.id,
        workTypeId: item.workTypeId,
        description: item.description,
        quantity: item.quantity,
        unit: item.unit,
        unitPrice: item.unitPrice,
        lineTotal: lineTotals[i],
        sortOrder: i,
      })),
    );

    await tx
      .update(quotes)
      .set({
        currentVersionId: version.id,
        // A new version always needs to go through send->sign again; a
        // brand-new quote is already 'draft', but reset an existing one
        // that had progressed further (sent/signed) back to draft too.
        status: isNewQuote ? undefined : "draft",
        updatedAt: new Date(),
      })
      .where(eq(quotes.id, quoteId));

    return { quoteId: quoteId!, quoteVersionId: version.id, versionNumber };
  };

  return db.transaction((tx) => run(tx));
}
