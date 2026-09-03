"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  jobs,
  jobStatuses,
  quotes,
  quoteVersions,
  quoteSignatures,
  quotePublicLinks,
  productionRequests,
  users,
  userPermissions,
} from "@/server/db/schema";
import { getCurrentUser } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { PERMISSIONS, type PermissionKey } from "@/server/auth/permission-keys";
import { recordAudit } from "@/server/audit";
import { generateSecureToken } from "@/server/tokens";
import { parseNonNegativeMoneyInput, isZero } from "@/server/money";
import { advanceJobStatus } from "@/server/jobs/status";
import { notifyUsers } from "@/server/notifications";
import { getJobDetail } from "@/server/jobs/queries";
import { createProductionRequest } from "@/server/production/create-request";
import { createQuoteVersion, type QuoteItemInput } from "./versions";
import { applySignedQuoteToJob } from "./convert";

export interface ActionState {
  error?: string;
  success?: boolean;
}

export interface SendQuoteState extends ActionState {
  publicPath?: string;
}

function emptyToUndefined(value: FormDataEntryValue | null): string | undefined {
  const s = typeof value === "string" ? value.trim() : "";
  return s.length > 0 ? s : undefined;
}

// ---------------------------------------------------------------------
// Save quote draft (creates the quote if needed, or a new version of an
// existing one). One dialog handles first-time creation, editing a draft,
// and revising a sent/signed quote — all go through createQuoteVersion.
// ---------------------------------------------------------------------
const RawQuoteItemSchema = z.object({
  workTypeId: z.string().uuid().optional(),
  description: z.string().trim().min(1),
  quantity: z.string().trim(),
  unit: z.string().trim().optional(),
  unitPrice: z.string().trim(),
});

const SaveQuoteDraftSchema = z.object({
  quoteId: z.string().uuid().optional(),
  itemsJson: z.string().min(1),
  paymentTerms: z.string().trim().optional(),
  workTerms: z.string().trim().optional(),
  validUntil: z.string().trim().optional(),
  // Document language (quotes.language) — the Quote Builder's language
  // selector always submits one of these two, defaulting to "ar" in the
  // dialog itself; falls back to "ar" here too if somehow missing/invalid
  // so a malformed submit never 500s.
  language: z.enum(["ar", "he"]).optional(),
  // AI quote-drafting provenance (quote_versions.is_ai_generated /
  // .ai_prompt_notes) — set only when this save originated from the
  // AI-draft -> Quote Builder handoff (src/server/quotes/ai-draft-actions.ts
  // never writes these itself, per the draft-assist-only design).
  isAiGenerated: z.literal("true").optional(),
  aiPromptNotes: z.string().trim().optional(),
});

export async function saveQuoteDraft(
  jobId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!can(user, PERMISSIONS.CREATE_QUOTE)) {
    return { error: "لا تملك صلاحية إنشاء عروض الأسعار." };
  }

  const parsed = SaveQuoteDraftSchema.safeParse({
    quoteId: emptyToUndefined(formData.get("quoteId")),
    itemsJson: formData.get("itemsJson"),
    paymentTerms: emptyToUndefined(formData.get("paymentTerms")),
    workTerms: emptyToUndefined(formData.get("workTerms")),
    validUntil: emptyToUndefined(formData.get("validUntil")),
    language: emptyToUndefined(formData.get("language")),
    isAiGenerated: emptyToUndefined(formData.get("isAiGenerated")),
    aiPromptNotes: emptyToUndefined(formData.get("aiPromptNotes")),
  });
  if (!parsed.success) return { error: "بيانات غير صحيحة" };

  let rawItems: unknown;
  try {
    rawItems = JSON.parse(parsed.data.itemsJson);
  } catch {
    return { error: "تعذرت قراءة بنود العرض" };
  }
  const itemsParsed = z.array(RawQuoteItemSchema).min(1).safeParse(rawItems);
  if (!itemsParsed.success) {
    return { error: "أضف بنداً واحداً على الأقل ببيانات صحيحة" };
  }

  const items: QuoteItemInput[] = [];
  for (const raw of itemsParsed.data) {
    const quantity = parseNonNegativeMoneyInput(raw.quantity);
    if (quantity === null || isZero(quantity)) {
      return { error: `كمية غير صحيحة للبند: ${raw.description}` };
    }
    const unitPrice = parseNonNegativeMoneyInput(raw.unitPrice);
    if (unitPrice === null) {
      return { error: `سعر غير صحيح للبند: ${raw.description}` };
    }
    items.push({
      workTypeId: raw.workTypeId,
      description: raw.description,
      quantity,
      unit: raw.unit,
      unitPrice,
    });
  }

  const [job] = await db
    .select({ customerId: jobs.customerId })
    .from(jobs)
    .where(eq(jobs.id, jobId))
    .limit(1);
  if (!job) return { error: "المهمة غير موجودة" };

  try {
    const result = await createQuoteVersion({
      jobId,
      customerId: job.customerId,
      quoteId: parsed.data.quoteId,
      createdByUserId: user!.id,
      items,
      paymentTerms: parsed.data.paymentTerms,
      workTerms: parsed.data.workTerms,
      validUntil: parsed.data.validUntil,
      language: parsed.data.language,
      isAiGenerated: parsed.data.isAiGenerated === "true",
      aiPromptNotes: parsed.data.aiPromptNotes,
    });

    await recordAudit({
      userId: user!.id,
      action: parsed.data.quoteId ? "quote.version_create" : "quote.create",
      entityType: "quote",
      entityId: result.quoteId,
      newValue: { versionNumber: result.versionNumber, jobId },
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "تعذر حفظ عرض السعر" };
  }

  revalidatePath(`/jobs/${jobId}`);
  return { success: true };
}

// ---------------------------------------------------------------------
// Send quote — issues a fresh public signing link and moves the job/quote
// forward. Re-sending (after an edit reset it to draft) simply issues a
// new link the same way; the previous one was already revoked when the new
// version was created (see createQuoteVersion).
// ---------------------------------------------------------------------
export async function sendQuoteAction(
  jobId: string,
  quoteId: string,
): Promise<SendQuoteState> {
  const user = await getCurrentUser();
  if (!can(user, PERMISSIONS.SEND_QUOTE)) {
    return { error: "لا تملك صلاحية إرسال عروض الأسعار." };
  }

  const [quote] = await db
    .select({ currentVersionId: quotes.currentVersionId })
    .from(quotes)
    .where(eq(quotes.id, quoteId))
    .limit(1);
  if (!quote?.currentVersionId) {
    return { error: "لا يوجد عرض سعر جاهز للإرسال." };
  }
  const [version] = await db
    .select({ validUntil: quoteVersions.validUntil })
    .from(quoteVersions)
    .where(eq(quoteVersions.id, quote.currentVersionId))
    .limit(1);

  const token = generateSecureToken();
  const expiresAt = version?.validUntil
    ? new Date(`${version.validUntil}T23:59:59`)
    : null;

  await db.transaction(async (tx) => {
    await tx.insert(quotePublicLinks).values({
      quoteId,
      token,
      expiresAt,
      createdByUserId: user!.id,
    });
    await tx
      .update(quotes)
      .set({ status: "sent", updatedAt: new Date() })
      .where(eq(quotes.id, quoteId));
    await advanceJobStatus(tx, jobId, "quote_sent");
    await recordAudit(
      {
        userId: user!.id,
        action: "quote.send",
        entityType: "quote",
        entityId: quoteId,
      },
      tx,
    );
  });

  revalidatePath(`/jobs/${jobId}`);
  return { success: true, publicPath: `/public/q/${token}` };
}

// ---------------------------------------------------------------------
// Convert a SIGNED quote into the job's authoritative items/price (section
// 20) — a separate, explicit action from signing itself.
// ---------------------------------------------------------------------
export async function convertQuoteToJob(
  jobId: string,
  quoteId: string,
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!can(user, PERMISSIONS.CLOSE_DEAL)) {
    return { error: "لا تملك صلاحية تحويل العرض إلى مهمة." };
  }

  const [job] = await db
    .select({ isTerminal: jobStatuses.isTerminal, sourceQuoteVersionId: jobs.sourceQuoteVersionId })
    .from(jobs)
    .innerJoin(jobStatuses, eq(jobs.statusId, jobStatuses.id))
    .where(eq(jobs.id, jobId))
    .limit(1);
  if (!job) return { error: "المهمة غير موجودة" };
  if (job.isTerminal) return { error: "لا يمكن تحويل عرض لمهمة مغلقة." };

  const [quote] = await db
    .select({ signedVersionId: quotes.signedVersionId })
    .from(quotes)
    .where(eq(quotes.id, quoteId))
    .limit(1);
  if (!quote?.signedVersionId) {
    return { error: "لا يوجد عرض موقّع لتحويله." };
  }
  if (quote.signedVersionId === job.sourceQuoteVersionId) {
    return { error: "تم تحويل هذا العرض بالفعل." };
  }

  // Commercial responsibility (section 16): the person converting a signed
  // quote into a job is the one closing the deal — enforced by the
  // PERMISSIONS.CLOSE_DEAL check above, matching that permission's own
  // description ("تسجيل إغلاق الصفقة بواسطة هذا المستخدم"). Delegated to
  // applySignedQuoteToJob (src/server/quotes/convert.ts), shared with the
  // automatic-on-signing path in signQuotePublicly below.
  await db.transaction(async (tx) => {
    await applySignedQuoteToJob(tx, {
      jobId,
      quoteId,
      signedVersionId: quote.signedVersionId!,
      dealClosedByUserId: user!.id,
    });
  });

  revalidatePath(`/jobs/${jobId}`);
  return { success: true };
}

// ---------------------------------------------------------------------
// Public e-signature capture (section 18) — NO permission check: the long
// random token itself is the security boundary, verified against
// quote_public_links, not against a logged-in session.
// ---------------------------------------------------------------------
const SignSchema = z.object({
  customerNameAtSigning: z.string().trim().min(1, { error: "الاسم مطلوب" }),
  customerPhoneAtSigning: z.string().trim().optional(),
  customerNationalIdAtSigning: z.string().trim().optional(),
  customerAddressAtSigning: z.string().trim().optional(),
  agreedToTerms: z.literal("on", { error: "يجب الموافقة على الشروط" }),
  signatureImage: z
    .string()
    .startsWith("data:image", { error: "التوقيع مطلوب" })
    .max(3_000_000, { error: "صورة التوقيع كبيرة جداً" }),
  latitude: z.string().trim().optional(),
  longitude: z.string().trim().optional(),
});

function parseLatLng(raw: string | undefined, min: number, max: number): string | null {
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n.toFixed(7);
}

export async function signQuotePublicly(
  token: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = SignSchema.safeParse({
    customerNameAtSigning: formData.get("customerNameAtSigning"),
    customerPhoneAtSigning: emptyToUndefined(formData.get("customerPhoneAtSigning")),
    customerNationalIdAtSigning: emptyToUndefined(
      formData.get("customerNationalIdAtSigning"),
    ),
    customerAddressAtSigning: emptyToUndefined(formData.get("customerAddressAtSigning")),
    agreedToTerms: formData.get("agreedToTerms"),
    signatureImage: formData.get("signatureImage"),
    latitude: emptyToUndefined(formData.get("latitude")),
    longitude: emptyToUndefined(formData.get("longitude")),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" };
  }

  const [link] = await db
    .select()
    .from(quotePublicLinks)
    .where(eq(quotePublicLinks.token, token))
    .limit(1);
  if (!link) return { error: "رابط غير صالح." };
  if (link.revokedAt) return { error: "تم إلغاء هذا الرابط." };
  if (link.expiresAt && link.expiresAt < new Date()) {
    return { error: "انتهت صلاحية هذا الرابط." };
  }

  const [quote] = await db
    .select()
    .from(quotes)
    .where(eq(quotes.id, link.quoteId))
    .limit(1);
  if (!quote?.currentVersionId) return { error: "تعذر العثور على عرض السعر." };

  const [version] = await db
    .select({ id: quoteVersions.id, isSigned: quoteVersions.isSigned })
    .from(quoteVersions)
    .where(eq(quoteVersions.id, quote.currentVersionId))
    .limit(1);
  if (!version) return { error: "تعذر العثور على عرض السعر." };
  if (version.isSigned) return { error: "تم توقيع هذا العرض مسبقاً." };

  const headersList = await headers();
  const forwardedFor = headersList.get("x-forwarded-for");
  const ipAddress = forwardedFor?.split(",")[0]?.trim() || null;

  try {
    await db.transaction(async (tx) => {
      // The real duplicate-signing guard is the unique constraint on
      // quote_signatures.quote_version_id: if two submits race past the
      // isSigned check above, the second insert below throws 23505, caught
      // further down. This update itself is unconditional.
      await tx
        .update(quoteVersions)
        .set({ isSigned: true })
        .where(eq(quoteVersions.id, version.id));

      await tx.insert(quoteSignatures).values({
        quoteVersionId: version.id,
        signedAt: new Date(),
        customerNameAtSigning: parsed.data.customerNameAtSigning,
        customerPhoneAtSigning: parsed.data.customerPhoneAtSigning,
        customerNationalIdAtSigning: parsed.data.customerNationalIdAtSigning,
        customerAddressAtSigning: parsed.data.customerAddressAtSigning,
        latitude: parseLatLng(parsed.data.latitude, -90, 90),
        longitude: parseLatLng(parsed.data.longitude, -180, 180),
        agreedToTerms: true,
        signatureImage: parsed.data.signatureImage,
        ipAddress,
      });

      await tx
        .update(quotes)
        .set({ status: "signed", signedVersionId: version.id, updatedAt: new Date() })
        .where(eq(quotes.id, quote.id));

      await advanceJobStatus(tx, quote.jobId, "quote_signed");

      await recordAudit(
        {
          userId: null,
          action: "quote.sign",
          entityType: "quote",
          entityId: quote.id,
          newValue: { customerNameAtSigning: parsed.data.customerNameAtSigning },
        },
        tx,
      );
    });
  } catch (err: unknown) {
    const code = (err as { code?: string } | null)?.code;
    if (code === "23505") {
      return { error: "تم توقيع هذا العرض للتو من جهاز آخر." };
    }
    return { error: "تعذر حفظ التوقيع، حاول مرة أخرى." };
  }

  // ---------------------------------------------------------------------
  // Best-effort automatic post-signing routing (auto-convert-to-job, then
  // auto-send-to-factory) — runs AFTER the signature transaction above has
  // already committed. The customer's signature is now durably saved no
  // matter what happens below; this whole sequence is wrapped so nothing
  // it does can ever change the response signQuotePublicly hands back to
  // the customer's own browser. Any failure here is caught, audited, and
  // surfaced to the relevant staff via notification, with the existing
  // manual "تحويل إلى مهمة" / "إرسال إلى المصنع" buttons remaining fully
  // available as the fallback — see runPostSignAutomation below.
  // ---------------------------------------------------------------------
  try {
    await runPostSignAutomation({
      jobId: quote.jobId,
      quoteId: quote.id,
      signedVersionId: version.id,
      quoteCreatedByUserId: quote.createdByUserId,
    });
  } catch {
    // Defense in depth: runPostSignAutomation already catches everything
    // internally. This outer catch just guarantees that even a bug in its
    // own error handling can never reach the customer's response.
  }

  revalidatePath(`/public/q/${token}`);
  return { success: true };
}

// ---------------------------------------------------------------------
// Post-signing automation internals — not exported, no permission check
// (there is no acting user on the public signing path to check against;
// see the module's public-signing comment above signQuotePublicly). The
// reusable core logic these call (applySignedQuoteToJob,
// createProductionRequest) is identical to what the permission-gated
// manual actions run, so behavior only differs in who is attributed and
// that failures are caught instead of surfaced to a form.
// ---------------------------------------------------------------------

async function getUsersWithPermission(permissionKey: PermissionKey) {
  return db
    .select({ id: users.id })
    .from(userPermissions)
    .innerJoin(users, eq(userPermissions.userId, users.id))
    .where(
      and(
        eq(userPermissions.permissionKey, permissionKey),
        eq(users.status, "active"),
        isNull(users.deletedAt),
      ),
    );
}

interface AutoFactoryItem {
  description: string | null;
  quantity: string;
  unit: string | null;
  workTypeLabelAr?: string | null;
}

/** Mirrors production-section.tsx's summarizeJobItemsForFactory — same
 * plain-text convention the manual "إرسال إلى المصنع" dialog prefills, so
 * an auto-generated request reads the same way a human-sent one does. */
function summarizeJobItemsForAutoFactory(items: AutoFactoryItem[]): string {
  if (items.length === 0) return "راجع صفحة المهمة للتفاصيل.";
  return items
    .map(
      (item) =>
        `- ${item.workTypeLabelAr || item.description || "بند عمل"} (${item.quantity} ${item.unit ?? ""})`,
    )
    .join("\n");
}

interface AutoFactoryMeasurement {
  glassTypeLabelAr: string | null;
  attachments: unknown[];
}

/** Attachments stay behind authentication (a hardened route, per this
 * codebase's earlier stored-XSS fix) — never linked from the factory's own
 * public page. This just tells office/factory-liaison staff to go look at
 * the job page, per the New Measurement quick-submit flow's glass type /
 * attachment fields (getJobDetail). Returns null when there's nothing to
 * mention (an ordinary office-recorded measurement, or no measurement at all). */
function buildMeasurementMentionLine(measurements: AutoFactoryMeasurement[]): string | null {
  const glassTypeLabels = Array.from(
    new Set(measurements.map((m) => m.glassTypeLabelAr).filter((v): v is string => !!v)),
  );
  const attachmentCount = measurements.reduce((sum, m) => sum + m.attachments.length, 0);
  if (glassTypeLabels.length === 0 && attachmentCount === 0) return null;

  const parts: string[] = [];
  if (glassTypeLabels.length > 0) parts.push(`نوع الزجاج: ${glassTypeLabels.join("، ")}`);
  if (attachmentCount > 0) parts.push(`يوجد ${attachmentCount} مرفق`);
  return `${parts.join("، ")} - راجع صفحة المهمة للاطلاع عليها.`;
}

/**
 * Steps a-d of the auto-convert / auto-send-to-factory sequence (section
 * 20/43, driven automatically off a customer's public e-signature). Never
 * throws — every step is independently try/caught so a failure partway
 * through stops just that step and notifies the right people, instead of
 * losing the steps that already succeeded or crashing the caller.
 */
async function runPostSignAutomation(params: {
  jobId: string;
  quoteId: string;
  signedVersionId: string;
  quoteCreatedByUserId: string | null;
}): Promise<void> {
  try {
    const [job] = await db
      .select({
        jobNumber: jobs.jobNumber,
        pricingResponsibleUserId: jobs.pricingResponsibleUserId,
      })
      .from(jobs)
      .where(eq(jobs.id, params.jobId))
      .limit(1);
    if (!job) return; // defense in depth — the job that owns this quote must exist

    // (a) Resolve who "closed the deal" — see applySignedQuoteToJob's own
    // doc comment on dealClosedByUserId for why createdByUserId is the
    // closest real proxy here, and pricingResponsibleUserId the fallback.
    const dealClosedByUserId = params.quoteCreatedByUserId ?? job.pricingResponsibleUserId;
    if (!dealClosedByUserId) {
      const closeDealHolders = await getUsersWithPermission(PERMISSIONS.CLOSE_DEAL);
      await notifyUsers(
        closeDealHolders.map((u) => u.id),
        {
          type: "quote_auto_convert_needs_manual",
          title: `تم توقيع عرض السعر للمهمة ${job.jobNumber} — يلزم تحويلها يدوياً`,
          body: "تعذر تحديد المستخدم المسؤول عن إغلاق الصفقة تلقائياً. استخدم زر «تحويل إلى مهمة» على صفحة المهمة.",
          relatedEntityType: "job",
          relatedEntityId: params.jobId,
        },
      );
      return;
    }

    // (b) Auto-convert — identical core logic to the manual button.
    try {
      await db.transaction(async (tx) => {
        await applySignedQuoteToJob(tx, {
          jobId: params.jobId,
          quoteId: params.quoteId,
          signedVersionId: params.signedVersionId,
          dealClosedByUserId,
        });
      });
    } catch (err) {
      await recordAudit({
        userId: null,
        action: "quote.auto_convert_failed",
        entityType: "job",
        entityId: params.jobId,
        newValue: {
          quoteId: params.quoteId,
          error: err instanceof Error ? err.message : String(err),
        },
      });
      const closeDealHolders = await getUsersWithPermission(PERMISSIONS.CLOSE_DEAL);
      await notifyUsers(
        closeDealHolders.map((u) => u.id),
        {
          type: "quote_auto_convert_failed",
          title: `تعذر تحويل عرض المهمة ${job.jobNumber} الموقّع إلى مهمة تلقائياً`,
          body: "استخدم زر «تحويل إلى مهمة» على صفحة المهمة لإتمام التحويل يدوياً.",
          relatedEntityType: "job",
          relatedEntityId: params.jobId,
        },
      );
      return; // do not attempt the factory step on top of a failed conversion
    }

    // (c) Auto-send-to-factory — build the same kind of details text the
    // manual dialog prefills, then run the identical core logic.
    let details: string;
    try {
      const jobDetail = await getJobDetail(params.jobId);
      const itemsText = summarizeJobItemsForAutoFactory(jobDetail?.items ?? []);
      const mentionLine = buildMeasurementMentionLine(jobDetail?.measurements ?? []);
      details = [itemsText, mentionLine].filter((line): line is string => !!line).join("\n\n");
    } catch {
      details = "راجع صفحة المهمة للتفاصيل.";
    }

    try {
      // Guard against a duplicate request in the unlikely event one was
      // already created by hand in the tiny window since step (b) — the
      // manual action has this same guard; createProductionRequest itself
      // does not (see its own doc comment).
      const [existingRequest] = await db
        .select({ id: productionRequests.id })
        .from(productionRequests)
        .where(eq(productionRequests.jobId, params.jobId))
        .limit(1);
      if (existingRequest) return;

      await db.transaction(async (tx) => {
        await createProductionRequest(tx, {
          jobId: params.jobId,
          details,
          estimatedReadyDate: null,
          requestedByUserId: dealClosedByUserId,
        });
      });
    } catch (err) {
      await recordAudit({
        userId: null,
        action: "production_request.auto_create_failed",
        entityType: "job",
        entityId: params.jobId,
        newValue: { error: err instanceof Error ? err.message : String(err) },
      });
      const factoryHolders = await getUsersWithPermission(PERMISSIONS.CREATE_PRODUCTION_ORDER);
      await notifyUsers(
        factoryHolders.map((u) => u.id),
        {
          type: "production_request_auto_create_failed",
          title: `تم تحويل عرض المهمة ${job.jobNumber} إلى مهمة، لكن تعذر إرسالها إلى المصنع تلقائياً`,
          body: "المهمة بانتظار الإنتاج بالفعل — استخدم زر «إرسال إلى المصنع» على صفحة المهمة لإتمام الإرسال يدوياً.",
          relatedEntityType: "job",
          relatedEntityId: params.jobId,
        },
      );
      return;
    }

    // (d) Both steps succeeded — a positive confirmation, not just silence.
    const factoryHolders = await getUsersWithPermission(PERMISSIONS.CREATE_PRODUCTION_ORDER);
    const notifyIds = new Set([dealClosedByUserId, ...factoryHolders.map((u) => u.id)]);
    await notifyUsers(Array.from(notifyIds), {
      type: "quote_auto_converted_and_sent",
      title: `وقّع العميل عرض المهمة ${job.jobNumber} — تم تحويلها وإرسالها إلى المصنع تلقائياً`,
      relatedEntityType: "job",
      relatedEntityId: params.jobId,
    });
  } catch {
    // Top-level defense in depth (constraint 4's own instruction): nothing
    // from this best-effort sequence may ever propagate out of this
    // function, no matter what fails or where.
  }
}
