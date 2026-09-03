import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { measurementAttachments, measurements } from "@/server/db/schema";
import { getCurrentUser } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { PERMISSIONS } from "@/server/auth/permission-keys";
import { getJobDetail } from "@/server/jobs/queries";
import { readMeasurementAttachment } from "@/server/storage/attachments";

/**
 * Authenticated attachment retrieval (New Measurement quick-submit flow,
 * docs/superpowers/specs/2026-09-03-new-measurement-quick-submit-design.md
 * section 5) — files live outside `public/`, so this route is the only way
 * back to one. Gated exactly like the job detail page itself and the
 * quote-PDF route (VIEW_ALL_JOBS, or personal involvement in the owning
 * job) — a Route Handler is outside proxy.ts's matcher, so this check is
 * the only thing standing between an authenticated-but-uninvolved user and
 * someone else's attachment.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ attachmentId: string }> },
) {
  const { attachmentId } = await params;
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "يجب تسجيل الدخول." }, { status: 401 });
  }

  const rows = await db
    .select({
      id: measurementAttachments.id,
      fileName: measurementAttachments.fileName,
      storagePath: measurementAttachments.storagePath,
      mimeType: measurementAttachments.mimeType,
      jobId: measurements.jobId,
    })
    .from(measurementAttachments)
    .innerJoin(
      measurements,
      eq(measurementAttachments.measurementId, measurements.id),
    )
    .where(eq(measurementAttachments.id, attachmentId))
    .limit(1);
  const attachment = rows[0];
  if (!attachment) {
    return NextResponse.json({ error: "الملف غير موجود." }, { status: 404 });
  }

  const job = await getJobDetail(attachment.jobId);
  if (!job) {
    return NextResponse.json({ error: "المهمة غير موجودة." }, { status: 404 });
  }
  const isInvolved =
    job.measuredByUserId === user.id ||
    job.pricingResponsibleUserId === user.id ||
    job.dealClosedByUserId === user.id ||
    job.assignments.some((a) => a.userId === user.id);
  if (!can(user, PERMISSIONS.VIEW_ALL_JOBS) && !isInvolved) {
    return NextResponse.json({ error: "لا تملك صلاحية الوصول." }, { status: 403 });
  }

  let bytes: Buffer;
  try {
    bytes = await readMeasurementAttachment(attachment.storagePath);
  } catch {
    return NextResponse.json({ error: "تعذر العثور على الملف." }, { status: 404 });
  }

  // inline (not attachment) so images/PDFs preview in-browser rather than
  // force-downloading — the encoded filename* form is RFC 5987, so an
  // original Arabic filename round-trips correctly too.
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": attachment.mimeType,
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`,
      "Content-Length": String(bytes.length),
    },
  });
}
