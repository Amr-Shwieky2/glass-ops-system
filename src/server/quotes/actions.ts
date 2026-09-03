"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  jobs,
  jobStatuses,
  jobItems,
  quotes,
  quoteVersions,
  quoteItems,
  quoteSignatures,
  quotePublicLinks,
} from "@/server/db/schema";
import { getCurrentUser } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { PERMISSIONS } from "@/server/auth/permission-keys";
import { recordAudit } from "@/server/audit";
import { generateSecureToken } from "@/server/tokens";
import { parseNonNegativeMoneyInput, isZero } from "@/server/money";
import { advanceJobStatus } from "@/server/jobs/status";
import { createQuoteVersion, type QuoteItemInput } from "./versions";

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

  const [version] = await db
    .select({ total: quoteVersions.total })
    .from(quoteVersions)
    .where(eq(quoteVersions.id, quote.signedVersionId))
    .limit(1);
  const items = await db
    .select()
    .from(quoteItems)
    .where(eq(quoteItems.quoteVersionId, quote.signedVersionId))
    .orderBy(quoteItems.sortOrder);

  await db.transaction(async (tx) => {
    await tx.delete(jobItems).where(eq(jobItems.jobId, jobId));
    if (items.length > 0) {
      await tx.insert(jobItems).values(
        items.map((item) => ({
          jobId,
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
        quoteId,
        sourceQuoteVersionId: quote.signedVersionId,
        // Commercial responsibility (section 16): the person converting a
        // signed quote into a job is the one closing the deal — enforced by
        // the PERMISSIONS.CLOSE_DEAL check above, matching that permission's
        // own description ("تسجيل إغلاق الصفقة بواسطة هذا المستخدم"). This is
        // a hard prerequisite for commission calculation (see
        // src/server/compensation/commission.ts's computeCommission).
        dealClosedByUserId: user!.id,
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, jobId));
    await advanceJobStatus(tx, jobId, "waiting_for_production");
    await recordAudit(
      {
        userId: user!.id,
        action: "quote.convert_to_job",
        entityType: "job",
        entityId: jobId,
        newValue: { quoteId, sourceQuoteVersionId: quote.signedVersionId },
      },
      tx,
    );
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

  revalidatePath(`/public/q/${token}`);
  return { success: true };
}
