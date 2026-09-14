"use server";

import { z } from "zod";
import { getCurrentUser } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { PERMISSIONS } from "@/server/auth/permission-keys";
import { recordAudit } from "@/server/audit";
import { getJobDetail } from "@/server/jobs/queries";
import { assertJobVisible } from "@/server/jobs/access";
import {
  generateHebrewQuoteDraft,
  QuoteDraftGenerationError,
  type DraftedQuote,
} from "@/server/ai/quote-generator";

export interface QuoteDraftActionState {
  error?: string;
  success?: boolean;
  /** The AI-drafted items/terms, present only on success. Never written to
   * the database by this action — per the draft-assist-only design (see
   * AGENTS.md), the caller's UI stage feeds this into the existing Quote
   * Builder dialog for a human (CREATE_QUOTE holder) to review, edit, and
   * explicitly save/send exactly like today's manual flow. */
  draft?: DraftedQuote;
}

const GenerateQuoteDraftSchema = z.object({
  jobDescription: z.string().trim().min(1, { error: "وصف العمل مطلوب" }),
});

type JobDetail = NonNullable<Awaited<ReturnType<typeof getJobDetail>>>;

/** Best-effort measurement context for a job: the most recent measurement's
 * free-text details and glass type label (getJobDetail already orders
 * `measurements` by desc(measuredAt), so [0] is the latest), covering both
 * an office-recorded measurement and one from the New Measurement
 * quick-submit flow. A job with no measurement at all — perfectly normal
 * for an early-stage quote — simply contributes no extra context;
 * generateHebrewQuoteDraft treats both fields as optional. */
function pickMeasurementContext(
  job: JobDetail,
): { measurementDetails?: string; glassTypeLabel?: string } {
  const latest = job.measurements[0];
  if (!latest) return {};
  return {
    measurementDetails: latest.details ?? undefined,
    glassTypeLabel: latest.glassTypeLabelAr ?? undefined,
  };
}

/**
 * AI-assisted quote drafting (draft-assist only, NEVER auto-send — see
 * AGENTS.md and src/server/ai/quote-generator.ts's doc comment). Requires
 * CREATE_QUOTE, the same permission the manual Quote Builder requires,
 * since this only produces a starting point for that same flow. Never
 * calls createQuoteVersion / createQuote itself, and never touches
 * quotes/quote_versions in any way.
 */
export async function generateQuoteDraftAction(
  jobId: string,
  _prevState: QuoteDraftActionState,
  formData: FormData,
): Promise<QuoteDraftActionState> {
  const user = await getCurrentUser();
  if (!can(user, PERMISSIONS.CREATE_QUOTE)) {
    return { error: "لا تملك صلاحية إنشاء عروض الأسعار." };
  }
  const visErr = await assertJobVisible(user, jobId);
  if (visErr) return { error: visErr };

  const parsed = GenerateQuoteDraftSchema.safeParse({
    jobDescription: formData.get("jobDescription"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" };
  }

  const job = await getJobDetail(jobId);
  if (!job) return { error: "المهمة غير موجودة" };

  let draft: DraftedQuote;
  try {
    draft = await generateHebrewQuoteDraft({
      jobDescription: parsed.data.jobDescription,
      ...pickMeasurementContext(job),
    });
  } catch (err) {
    if (err instanceof QuoteDraftGenerationError) {
      return { error: err.message };
    }
    // Should be unreachable — generateHebrewQuoteDraft only ever throws
    // QuoteDraftGenerationError — but never let anything else escape to
    // the UI as a raw error either.
    return { error: "تعذر إنشاء المسودة، حاول تعديل الوصف أو إنشاء العرض يدوياً" };
  }

  // Audited even though nothing else in the database changed, so there is
  // a trail of when/how AI was used to seed a quote (AGENTS.md).
  await recordAudit({
    userId: user!.id,
    action: "quote.ai_draft_generated",
    entityType: "job",
    entityId: jobId,
    newValue: { jobDescription: parsed.data.jobDescription, itemCount: draft.items.length },
  });

  return { success: true, draft };
}
