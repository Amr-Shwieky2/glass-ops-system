import "server-only";
import { eq } from "drizzle-orm";
import type { Database } from "@/server/db/client";
import {
  jobs,
  jobItems,
  quoteVersions,
  quoteItems,
  quoteSignatures,
} from "@/server/db/schema";
import { advanceJobStatus } from "@/server/jobs/status";
import { recordAudit } from "@/server/audit";

export interface ApplySignedQuoteToJobParams {
  jobId: string;
  quoteId: string;
  signedVersionId: string;
  /**
   * Commercial responsibility (section 16) — see the doc comment this
   * function's body carries on jobs.dealClosedByUserId, and
   * computeCommission's use of that column as a hard prerequisite for
   * commission calculation. The manual "تحويل إلى مهمة" action
   * (convertQuoteToJob) passes the ACTING user's id here, unchanged from
   * before this function existed. The automatic on-signing path
   * (signQuotePublicly) resolves this to the quote's createdByUserId,
   * falling back to the job's pricingResponsibleUserId, since there is no
   * acting user when the customer signs anonymously via a public token.
   */
  dealClosedByUserId: string;
}

/**
 * THE core "signed quote -> job's authoritative items/price" transaction
 * body (section 20), extracted out of convertQuoteToJob so both the manual
 * action and the automatic-on-signing path (signQuotePublicly, section
 * 18) run byte-for-byte identical logic. `tx` must already be inside a
 * transaction. This function does NO validation of its own (permission,
 * job-not-terminal, quote-actually-signed, not-already-converted) — every
 * caller is responsible for checking those first, exactly as
 * convertQuoteToJob always has.
 */
export async function applySignedQuoteToJob(
  tx: Database,
  params: ApplySignedQuoteToJobParams,
): Promise<void> {
  const [version] = await tx
    .select({ total: quoteVersions.total })
    .from(quoteVersions)
    .where(eq(quoteVersions.id, params.signedVersionId))
    .limit(1);
  const items = await tx
    .select()
    .from(quoteItems)
    .where(eq(quoteItems.quoteVersionId, params.signedVersionId))
    .orderBy(quoteItems.sortOrder);

  // Signing-time address propagation (Sprint 4): the customer's confirmed
  // installation address/location, captured immutably on quoteSignatures at
  // the moment of signing (never touched again — see that table's doc
  // comment), is the best available source of truth for where the job is
  // actually being installed. Copy it into the OPERATIONAL jobs.address/
  // latitude/longitude (which the Call/Waze/Maps buttons and any future
  // installer view read) — this only ever runs once per job (this whole
  // function is guarded by callers' "not already converted" checks), and
  // never touches quote_signatures itself, so the original signed record
  // stays exactly as historical evidence. A quote signed with no address
  // captured (should not happen given SignSchema requires it, but this
  // function makes no assumptions about its caller) simply leaves the
  // job's existing address/coordinates untouched.
  const [signature] = await tx
    .select({
      address: quoteSignatures.customerAddressAtSigning,
      latitude: quoteSignatures.latitude,
      longitude: quoteSignatures.longitude,
    })
    .from(quoteSignatures)
    .where(eq(quoteSignatures.quoteVersionId, params.signedVersionId))
    .limit(1);

  await tx.delete(jobItems).where(eq(jobItems.jobId, params.jobId));
  if (items.length > 0) {
    await tx.insert(jobItems).values(
      items.map((item) => ({
        jobId: params.jobId,
        workTypeId: item.workTypeId,
        description: item.description,
        quantity: item.quantity,
        unit: item.unit,
        salePrice: item.lineTotal,
        status: "pending" as const,
      })),
    );
  }

  await tx
    .update(jobs)
    .set({
      salePriceTotal: version?.total,
      quoteId: params.quoteId,
      sourceQuoteVersionId: params.signedVersionId,
      // Commercial responsibility (section 16): whoever is passed as
      // dealClosedByUserId is treated as the one closing the deal — a hard
      // prerequisite for commission calculation (see
      // src/server/compensation/commission.ts's computeCommission). See
      // this parameter's own doc comment above for how each caller
      // resolves it.
      dealClosedByUserId: params.dealClosedByUserId,
      ...(signature?.address ? { address: signature.address } : {}),
      ...(signature?.latitude ? { latitude: signature.latitude } : {}),
      ...(signature?.longitude ? { longitude: signature.longitude } : {}),
      updatedAt: new Date(),
    })
    .where(eq(jobs.id, params.jobId));

  await advanceJobStatus(tx, params.jobId, "waiting_for_production");

  await recordAudit(
    {
      userId: params.dealClosedByUserId,
      action: "quote.convert_to_job",
      entityType: "job",
      entityId: params.jobId,
      newValue: { quoteId: params.quoteId, sourceQuoteVersionId: params.signedVersionId },
    },
    tx,
  );
}
