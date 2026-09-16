import "server-only";
import { and, count, desc, eq, ilike, inArray, isNull, or } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  productionRequests,
  factorySubmissions,
  factoryPublicLinks,
  jobs,
  customers,
  users,
  jobItems,
  workTypes,
  measurements,
  measurementAttachments,
  glassTypes,
} from "@/server/db/schema";

/** The one production-request thread for a job (mirrors getQuoteForJob's
 * "a job has at most one thread, versioned/re-attempted internally" shape —
 * here re-attempts are new factory_submissions rows, not new request rows).
 * Null if the job was never sent to the factory. */
export async function getProductionRequestForJob(jobId: string) {
  const [request] = await db
    .select({
      id: productionRequests.id,
      requestNumber: productionRequests.requestNumber,
      jobId: productionRequests.jobId,
      requestedByUserId: productionRequests.requestedByUserId,
      requestedByName: users.name,
      details: productionRequests.details,
      status: productionRequests.status,
      estimatedReadyDate: productionRequests.estimatedReadyDate,
      createdAt: productionRequests.createdAt,
      updatedAt: productionRequests.updatedAt,
    })
    .from(productionRequests)
    .leftJoin(users, eq(productionRequests.requestedByUserId, users.id))
    .where(eq(productionRequests.jobId, jobId))
    .orderBy(desc(productionRequests.createdAt))
    .limit(1);
  if (!request) return null;

  const [submissions, activeLink] = await Promise.all([
    db
      .select({
        id: factorySubmissions.id,
        submittedPrice: factorySubmissions.submittedPrice,
        notes: factorySubmissions.notes,
        estimatedReadyDate: factorySubmissions.estimatedReadyDate,
        submittedAt: factorySubmissions.submittedAt,
        approvalStatus: factorySubmissions.approvalStatus,
        approvedByUserId: factorySubmissions.approvedByUserId,
        approvedByName: users.name,
        approvedAt: factorySubmissions.approvedAt,
        rejectionReason: factorySubmissions.rejectionReason,
      })
      .from(factorySubmissions)
      .leftJoin(users, eq(factorySubmissions.approvedByUserId, users.id))
      .where(eq(factorySubmissions.productionRequestId, request.id))
      .orderBy(desc(factorySubmissions.submittedAt)),
    db
      .select()
      .from(factoryPublicLinks)
      .where(
        and(
          eq(factoryPublicLinks.productionRequestId, request.id),
          isNull(factoryPublicLinks.revokedAt),
        ),
      )
      .orderBy(desc(factoryPublicLinks.createdAt))
      .limit(1)
      .then((r) => r[0] ?? null),
  ]);

  return {
    ...request,
    submissions,
    latestSubmission: submissions[0] ?? null,
    activeLink,
  };
}

export type ProductionRequestForJob = NonNullable<
  Awaited<ReturnType<typeof getProductionRequestForJob>>
>;

export interface PublicFactoryJobItem {
  id: string;
  description: string | null;
  quantity: string;
  unit: string | null;
  workTypeLabelAr: string | null;
  notes: string | null;
}

export interface PublicFactoryAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
}

export interface PublicFactoryMeasurement {
  id: string;
  glassTypeLabelAr: string | null;
  details: string | null;
  attachments: PublicFactoryAttachment[];
}

/**
 * Public factory-facing lookup — the token IS the security boundary here,
 * same posture as getQuoteByPublicToken (section 44/45). Returns null for
 * any token that doesn't resolve at all; the page distinguishes
 * revoked/approved/awaiting-review/pending via fields on the result.
 *
 * Sprint 4 — carries exactly the production-relevant subset of the job the
 * factory needs to actually manufacture the order: job items (work
 * type/description/quantity/unit/production notes, deliberately never
 * salePrice/expectedCost), measurements (glass type + the free-text
 * measurement/dimensions record, deliberately never fieldQuotedPrice), and
 * the measurement attachments themselves with a `url` into the FACTORY-
 * TOKEN-scoped retrieval route (`/api/public/pr/[token]/attachments/
 * [attachmentId]`, src/app/api/public/pr/[token]/attachments/
 * [attachmentId]/route.ts) — never the authenticated employee-only
 * `/api/attachments/:id` route, which a tokenless factory visitor could
 * never call anyway. Sale price, customer payments, profitability,
 * commissions, employee compensation, the customer's identity/national ID,
 * and jobs.notes (general/internal job notes, not production-specific) are
 * all deliberately excluded — this function is the one place that decides
 * what a factory-token holder is allowed to see, so every field it selects
 * has been checked against that list.
 */
export async function getProductionRequestByPublicToken(token: string) {
  const [link] = await db
    .select()
    .from(factoryPublicLinks)
    .where(eq(factoryPublicLinks.token, token))
    .limit(1);
  if (!link) return null;

  const [request] = await db
    .select()
    .from(productionRequests)
    .where(eq(productionRequests.id, link.productionRequestId))
    .limit(1);
  if (!request) return null;

  const [jobRow, submissions, itemRows, measurementRows, attachmentRows] = await Promise.all([
    db
      .select({ jobNumber: jobs.jobNumber, title: jobs.title })
      .from(jobs)
      .where(eq(jobs.id, request.jobId))
      .limit(1)
      .then((r) => r[0] ?? null),
    db
      .select()
      .from(factorySubmissions)
      .where(eq(factorySubmissions.productionRequestId, request.id))
      .orderBy(desc(factorySubmissions.submittedAt)),
    db
      .select({
        id: jobItems.id,
        description: jobItems.description,
        quantity: jobItems.quantity,
        unit: jobItems.unit,
        workTypeLabelAr: workTypes.labelAr,
        notes: jobItems.notes,
      })
      .from(jobItems)
      .leftJoin(workTypes, eq(jobItems.workTypeId, workTypes.id))
      .where(eq(jobItems.jobId, request.jobId))
      .orderBy(jobItems.createdAt),
    db
      .select({
        id: measurements.id,
        glassTypeLabelAr: glassTypes.labelAr,
        details: measurements.details,
      })
      .from(measurements)
      .leftJoin(glassTypes, eq(measurements.glassTypeId, glassTypes.id))
      .where(eq(measurements.jobId, request.jobId))
      .orderBy(desc(measurements.measuredAt)),
    db
      .select({
        id: measurementAttachments.id,
        measurementId: measurementAttachments.measurementId,
        fileName: measurementAttachments.fileName,
        mimeType: measurementAttachments.mimeType,
        sizeBytes: measurementAttachments.sizeBytes,
      })
      .from(measurementAttachments)
      .innerJoin(measurements, eq(measurementAttachments.measurementId, measurements.id))
      .where(eq(measurements.jobId, request.jobId))
      .orderBy(measurementAttachments.createdAt),
  ]);

  const measurementsWithAttachments: PublicFactoryMeasurement[] = measurementRows.map((m) => ({
    ...m,
    attachments: attachmentRows
      .filter((a) => a.measurementId === m.id)
      .map((a) => ({
        id: a.id,
        fileName: a.fileName,
        mimeType: a.mimeType,
        sizeBytes: a.sizeBytes,
        url: `/api/public/pr/${token}/attachments/${a.id}`,
      })),
  }));

  return {
    link,
    request,
    job: jobRow,
    submissions,
    latestSubmission: submissions[0] ?? null,
    isRevoked: link.revokedAt !== null,
    // Sprint 7 (S7.5) — expiresAt existed on the schema with nothing ever
    // checking it (the public lookup/submission path only ever checked
    // revokedAt). A null expiresAt (a link created before this sprint)
    // never expires, matching quote links' own "null = no expiry" posture.
    isExpired: link.expiresAt !== null && link.expiresAt < new Date(),
    items: itemRows as PublicFactoryJobItem[],
    measurements: measurementsWithAttachments,
  };
}

export type PublicProductionRequest = NonNullable<
  Awaited<ReturnType<typeof getProductionRequestByPublicToken>>
>;

export async function touchFactoryLinkAccess(token: string): Promise<void> {
  await db
    .update(factoryPublicLinks)
    .set({ lastAccessedAt: new Date() })
    .where(eq(factoryPublicLinks.token, token));
}

export type FactoryStatus = "pending" | "submitted" | "approved" | "rejected";
const FACTORY_STATUSES: readonly FactoryStatus[] = [
  "pending",
  "submitted",
  "approved",
  "rejected",
];
export function isFactoryStatus(value: string): value is FactoryStatus {
  return (FACTORY_STATUSES as readonly string[]).includes(value);
}

export interface ListProductionRequestsParams {
  search?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

/** Cross-job factory queue for the /production list page (nav already
 * gates it on CREATE_PRODUCTION_ORDER or APPROVE_FACTORY_PRICE) — no
 * per-row job-involvement restriction, same posture as the future
 * /approvals queue: holding either permission means seeing the whole
 * queue, not just "your own" jobs. */
export async function listProductionRequests(params: ListProductionRequestsParams) {
  const { search, status, limit = 25, offset = 0 } = params;

  const conditions = [];
  const term = search?.trim();
  if (term) {
    const pattern = `%${term}%`;
    conditions.push(
      or(
        ilike(jobs.jobNumber, pattern),
        ilike(customers.name, pattern),
        ilike(productionRequests.requestNumber, pattern),
      )!,
    );
  }
  if (status && isFactoryStatus(status)) {
    conditions.push(eq(productionRequests.status, status));
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, [{ value: total }]] = await Promise.all([
    db
      .select({
        id: productionRequests.id,
        requestNumber: productionRequests.requestNumber,
        jobId: productionRequests.jobId,
        jobNumber: jobs.jobNumber,
        customerName: customers.name,
        status: productionRequests.status,
        estimatedReadyDate: productionRequests.estimatedReadyDate,
        createdAt: productionRequests.createdAt,
      })
      .from(productionRequests)
      .innerJoin(jobs, eq(productionRequests.jobId, jobs.id))
      .innerJoin(customers, eq(jobs.customerId, customers.id))
      .where(where)
      .orderBy(desc(productionRequests.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ value: count() })
      .from(productionRequests)
      .innerJoin(jobs, eq(productionRequests.jobId, jobs.id))
      .innerJoin(customers, eq(jobs.customerId, customers.id))
      .where(where),
  ]);

  const requestIds = rows.map((r) => r.id);
  const latestByRequest = new Map<string, { submittedPrice: string; submittedAt: Date }>();
  if (requestIds.length > 0) {
    const allSubmissions = await db
      .select({
        productionRequestId: factorySubmissions.productionRequestId,
        submittedPrice: factorySubmissions.submittedPrice,
        submittedAt: factorySubmissions.submittedAt,
      })
      .from(factorySubmissions)
      .where(inArray(factorySubmissions.productionRequestId, requestIds))
      .orderBy(desc(factorySubmissions.submittedAt));
    // Rows come back newest-first per the ORDER BY above; keep only the
    // first one seen per request instead of a DISTINCT ON/window function,
    // consistent with this codebase's plain-query-builder style elsewhere.
    for (const s of allSubmissions) {
      if (!latestByRequest.has(s.productionRequestId)) {
        latestByRequest.set(s.productionRequestId, {
          submittedPrice: s.submittedPrice,
          submittedAt: s.submittedAt,
        });
      }
    }
  }

  return {
    rows: rows.map((r) => ({
      ...r,
      latestSubmittedPrice: latestByRequest.get(r.id)?.submittedPrice ?? null,
    })),
    total,
  };
}
