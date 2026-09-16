import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  factoryPublicLinks,
  productionRequests,
  measurementAttachments,
  measurements,
} from "@/server/db/schema";
import { readMeasurementAttachment } from "@/server/storage/attachments";
import { checkRateLimit } from "@/server/security/rate-limit";

/**
 * Factory-facing measurement attachment retrieval (Sprint 4) — the
 * production-relevant counterpart to the internal, authenticated
 * `/api/attachments/[attachmentId]` route (src/app/api/attachments/
 * [attachmentId]/route.ts). A factory contact has no employee account, so
 * that route is unreachable to them by design; this one exists specifically
 * so the public factory page (`/public/pr/[token]`) can link straight to
 * real measurement photos/PDFs instead of the old "راجع صفحة المهمة"
 * text-only mention, which pointed an unauthenticated external party at a
 * page they could never actually open.
 *
 * The factory public TOKEN is the entire security boundary here (same
 * posture as every other public/*-token route in this codebase — no
 * session, no permission check) — but unlike the quote-PDF/signing public
 * routes, this one also re-derives the attachment's OWNING job from the
 * database and checks it against the token's own production request's job,
 * exactly the "child must belong to the referenced parent" pattern from
 * this codebase's job-scoped/child-entity authorization audit: without it,
 * a valid factory token for Job A's production request would let that
 * factory fetch an arbitrary attachmentId belonging to a completely
 * unrelated Job B just by guessing/incrementing a UUID it was never handed.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string; attachmentId: string }> },
) {
  const { token, attachmentId } = await params;

  const rate = checkRateLimit(`public-factory-attachment:${token}`, {
    maxAttempts: 60,
    windowMs: 5 * 60_000,
    blockMs: 5 * 60_000,
  });
  if (!rate.allowed) {
    return NextResponse.json({ error: "محاولات كثيرة جداً. حاول مرة أخرى بعد قليل." }, { status: 429 });
  }

  const [link] = await db
    .select()
    .from(factoryPublicLinks)
    .where(eq(factoryPublicLinks.token, token))
    .limit(1);
  if (!link || link.revokedAt) {
    return NextResponse.json({ error: "رابط غير صالح." }, { status: 404 });
  }
  // Every other consumer of factoryPublicLinks (submitFactoryPriceAction,
  // getProductionRequestByPublicToken) treats expiresAt as a hard cutoff —
  // this route was the one place that didn't, letting an attachment URL
  // someone had already seen (a factory's email, browser history, a
  // forwarded link) keep serving a customer's measurement photos/PDFs
  // indefinitely past the link's normal 30-day validity window, with no
  // explicit revoke ever required.
  if (link.expiresAt && link.expiresAt < new Date()) {
    return NextResponse.json({ error: "انتهت صلاحية هذا الرابط." }, { status: 404 });
  }

  const [request] = await db
    .select({ jobId: productionRequests.jobId })
    .from(productionRequests)
    .where(eq(productionRequests.id, link.productionRequestId))
    .limit(1);
  if (!request) {
    return NextResponse.json({ error: "طلب الإنتاج غير موجود." }, { status: 404 });
  }

  const [attachment] = await db
    .select({
      id: measurementAttachments.id,
      fileName: measurementAttachments.fileName,
      storagePath: measurementAttachments.storagePath,
      mimeType: measurementAttachments.mimeType,
      jobId: measurements.jobId,
    })
    .from(measurementAttachments)
    .innerJoin(measurements, eq(measurementAttachments.measurementId, measurements.id))
    .where(eq(measurementAttachments.id, attachmentId))
    .limit(1);
  // Never trust the attachmentId in isolation — it must resolve to a
  // measurement on THIS token's own job, not merely exist somewhere in the
  // database (see this route's own doc comment above).
  if (!attachment || attachment.jobId !== request.jobId) {
    return NextResponse.json({ error: "الملف غير موجود." }, { status: 404 });
  }

  let bytes: Buffer;
  try {
    bytes = await readMeasurementAttachment(attachment.storagePath);
  } catch {
    return NextResponse.json({ error: "تعذر العثور على الملف." }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": attachment.mimeType,
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`,
      "Content-Length": String(bytes.length),
      "X-Content-Type-Options": "nosniff",
    },
  });
}
