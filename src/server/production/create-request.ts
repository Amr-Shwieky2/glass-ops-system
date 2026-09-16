import "server-only";
import type { Database } from "@/server/db/client";
import { productionRequests, factoryPublicLinks } from "@/server/db/schema";
import { advanceJobStatus } from "@/server/jobs/status";
import { recordAudit } from "@/server/audit";
import { generateSecureToken } from "@/server/tokens";
import { nextDocumentNumber } from "@/server/numbering";

/** Sprint 7 (S7.5) — how long a freshly-created factory public link stays
 * valid before requiring staff to explicitly regenerate it (see
 * regenerateFactoryLinkAction in src/server/production/actions.ts). Same
 * order of magnitude as a quote's own validity window (quote_validity_days
 * setting, default 14) — a factory doesn't need months to submit a price. */
export const FACTORY_LINK_VALIDITY_DAYS = 30;

export interface CreateProductionRequestParams {
  jobId: string;
  details: string;
  estimatedReadyDate?: string | null;
  requestedByUserId: string;
}

export interface CreateProductionRequestResult {
  request: typeof productionRequests.$inferSelect;
  token: string;
}

/**
 * THE core "create a production request AND immediately send it to the
 * factory" transaction body (section 43) — a production request has no
 * separate draft phase, so creating it IS sending it, in one transaction.
 * Extracted out of sendToFactoryAction so both the manual action and the
 * automatic-on-signing path (signQuotePublicly, section 18) run
 * byte-for-byte identical logic. `tx` must already be inside a
 * transaction. This function does NO validation of its own (permission,
 * job-not-terminal, no-existing-production-request-for-this-job) — every
 * caller is responsible for checking those first, exactly as
 * sendToFactoryAction always has.
 */
export async function createProductionRequest(
  tx: Database,
  params: CreateProductionRequestParams,
): Promise<CreateProductionRequestResult> {
  const requestNumber = await nextDocumentNumber("production_request", tx);

  const [request] = await tx
    .insert(productionRequests)
    .values({
      requestNumber,
      jobId: params.jobId,
      requestedByUserId: params.requestedByUserId,
      details: params.details,
      estimatedReadyDate: params.estimatedReadyDate || null,
    })
    .returning();

  const token = generateSecureToken();
  const expiresAt = new Date(Date.now() + FACTORY_LINK_VALIDITY_DAYS * 24 * 60 * 60_000);
  await tx.insert(factoryPublicLinks).values({
    productionRequestId: request.id,
    token,
    expiresAt,
  });

  await advanceJobStatus(tx, params.jobId, "in_production");

  await recordAudit(
    {
      userId: params.requestedByUserId,
      action: "production_request.create",
      entityType: "production_request",
      entityId: request.id,
      newValue: { jobId: params.jobId },
    },
    tx,
  );

  return { request, token };
}
