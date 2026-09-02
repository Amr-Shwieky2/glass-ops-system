"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db/client";
import { getCurrentUser } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { PERMISSIONS } from "@/server/auth/permission-keys";
import { recordAudit } from "@/server/audit";
import { parseNonNegativeMoneyInput } from "@/server/money";
import { getAllSettings, setSetting } from "@/server/settings";

export interface ActionState {
  error?: string;
  success?: boolean;
}

/**
 * Parses a "0-100, decimals allowed" percentage. Returns null on anything
 * else (empty, non-numeric, negative, over 100) so the caller can report a
 * single clear Arabic error rather than a stack of per-field ones.
 */
function parsePercent(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "" || !/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return n;
}

/** Parses a positive integer (">= 1"), e.g. "quote validity in days". */
function parsePositiveInt(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Every field the General Settings screen edits, covering the ENTIRE
 * application_settings schema (settings-defaults.ts's SettingsSchema) as
 * one form / one submit. logoDataUrl is deliberately out of scope for this
 * phase (a logo upload isn't needed yet) and is preserved untouched below.
 */
const UpdateGeneralSettingsSchema = z.object({
  commissionRatePercent: z.string({ error: "نسبة العمولة مطلوبة" }),
  quoteValidityDays: z.string({ error: "مدة صلاحية عرض السعر مطلوبة" }),
  vehicleUsageDeductionDefault: z.string({
    error: "قيمة خصم استخدام المركبة الافتراضية مطلوبة",
  }),
  measurementReminderMinutesBefore: z.string({
    error: "مدة التذكير بموعد القياس مطلوبة",
  }),
  installationReminderHoursBefore: z.string({
    error: "مدة التذكير بموعد التركيب مطلوبة",
  }),
  checkDueSoonDays: z.string({ error: "مدة تنبيه استحقاق الشيك مطلوبة" }),
  staleRepairDays: z.string({ error: "مدة تنبيه تأخر الإصلاح مطلوبة" }),
  companyName: z.string().trim().min(1, { error: "اسم الشركة مطلوب" }),
  companyAddress: z.string().optional(),
  companyPhone: z.string().optional(),
  companyEmail: z.string().optional(),
  companyTaxId: z.string().optional(),
  quotePaymentTerms: z
    .string()
    .trim()
    .min(1, { error: "شروط الدفع الافتراضية لعرض السعر مطلوبة" }),
  quoteWorkTerms: z
    .string()
    .trim()
    .min(1, { error: "شروط العمل الافتراضية لعرض السعر مطلوبة" }),
});

function formString(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v : "";
}

/**
 * Updates the whole General Settings screen in one submit (section 77).
 * Every value in application_settings is a single JSON row per top-level
 * key — company_info / quote_default_terms / notification_thresholds are
 * each ONE object, so this reads the existing full object via getAllSettings()
 * first and merges the submitted sub-fields into it, rather than writing a
 * partial object that would silently wipe sibling fields the form didn't
 * touch (e.g. saving company_info without company_info.logoDataUrl would
 * otherwise erase a logo that was set some other way).
 *
 * Writes only the top-level keys that actually changed, each with its own
 * setSetting() call and its own audit row (old value -> new value) so the
 * audit log reads as "commission changed from 10% to 12%", not one vague
 * "settings updated" row covering unrelated fields.
 */
export async function updateGeneralSettingsAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!can(user, PERMISSIONS.MANAGE_SETTINGS)) {
    return { error: "لا تملك صلاحية إدارة الإعدادات." };
  }

  const parsed = UpdateGeneralSettingsSchema.safeParse({
    commissionRatePercent: formString(formData, "commissionRatePercent"),
    quoteValidityDays: formString(formData, "quoteValidityDays"),
    vehicleUsageDeductionDefault: formString(formData, "vehicleUsageDeductionDefault"),
    measurementReminderMinutesBefore: formString(
      formData,
      "measurementReminderMinutesBefore",
    ),
    installationReminderHoursBefore: formString(
      formData,
      "installationReminderHoursBefore",
    ),
    checkDueSoonDays: formString(formData, "checkDueSoonDays"),
    staleRepairDays: formString(formData, "staleRepairDays"),
    companyName: formString(formData, "companyName"),
    companyAddress: formString(formData, "companyAddress"),
    companyPhone: formString(formData, "companyPhone"),
    companyEmail: formString(formData, "companyEmail"),
    companyTaxId: formString(formData, "companyTaxId"),
    quotePaymentTerms: formString(formData, "quotePaymentTerms"),
    quoteWorkTerms: formString(formData, "quoteWorkTerms"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" };
  }
  const data = parsed.data;

  const commissionRatePercent = parsePercent(data.commissionRatePercent);
  if (commissionRatePercent === null) {
    return { error: "نسبة العمولة يجب أن تكون رقماً بين 0 و 100." };
  }

  const quoteValidityDays = parsePositiveInt(data.quoteValidityDays);
  if (quoteValidityDays === null) {
    return { error: "مدة صلاحية عرض السعر يجب أن تكون رقماً صحيحاً موجباً." };
  }

  const vehicleUsageDeductionDefault = parseNonNegativeMoneyInput(
    data.vehicleUsageDeductionDefault,
  );
  if (vehicleUsageDeductionDefault === null) {
    return { error: "قيمة خصم استخدام المركبة الافتراضية غير صحيحة." };
  }

  const measurementReminderMinutesBefore = parsePositiveInt(
    data.measurementReminderMinutesBefore,
  );
  if (measurementReminderMinutesBefore === null) {
    return { error: "مدة التذكير بموعد القياس يجب أن تكون رقماً صحيحاً موجباً." };
  }
  const installationReminderHoursBefore = parsePositiveInt(
    data.installationReminderHoursBefore,
  );
  if (installationReminderHoursBefore === null) {
    return { error: "مدة التذكير بموعد التركيب يجب أن تكون رقماً صحيحاً موجباً." };
  }
  const checkDueSoonDays = parsePositiveInt(data.checkDueSoonDays);
  if (checkDueSoonDays === null) {
    return { error: "مدة تنبيه استحقاق الشيك يجب أن تكون رقماً صحيحاً موجباً." };
  }
  const staleRepairDays = parsePositiveInt(data.staleRepairDays);
  if (staleRepairDays === null) {
    return { error: "مدة تنبيه تأخر الإصلاح يجب أن تكون رقماً صحيحاً موجباً." };
  }

  const companyEmail = (data.companyEmail ?? "").trim();
  if (companyEmail !== "" && !EMAIL_RE.test(companyEmail)) {
    return { error: "البريد الإلكتروني للشركة غير صحيح." };
  }
  const companyAddress = (data.companyAddress ?? "").trim();
  const companyPhone = (data.companyPhone ?? "").trim();
  const companyTaxId = (data.companyTaxId ?? "").trim();

  const old = await getAllSettings();

  await db.transaction(async (tx) => {
    if (old.commission_rate_percent !== commissionRatePercent) {
      await setSetting("commission_rate_percent", commissionRatePercent, user!.id, tx);
      await recordAudit(
        {
          userId: user!.id,
          action: "settings.update",
          entityType: "application_setting",
          entityId: "commission_rate_percent",
          oldValue: old.commission_rate_percent,
          newValue: commissionRatePercent,
        },
        tx,
      );
    }

    if (old.quote_validity_days !== quoteValidityDays) {
      await setSetting("quote_validity_days", quoteValidityDays, user!.id, tx);
      await recordAudit(
        {
          userId: user!.id,
          action: "settings.update",
          entityType: "application_setting",
          entityId: "quote_validity_days",
          oldValue: old.quote_validity_days,
          newValue: quoteValidityDays,
        },
        tx,
      );
    }

    if (old.vehicle_usage_deduction_default !== vehicleUsageDeductionDefault) {
      await setSetting(
        "vehicle_usage_deduction_default",
        vehicleUsageDeductionDefault,
        user!.id,
        tx,
      );
      await recordAudit(
        {
          userId: user!.id,
          action: "settings.update",
          entityType: "application_setting",
          entityId: "vehicle_usage_deduction_default",
          oldValue: old.vehicle_usage_deduction_default,
          newValue: vehicleUsageDeductionDefault,
        },
        tx,
      );
    }

    const newCompanyInfo = {
      ...old.company_info,
      name: data.companyName.trim(),
      address: companyAddress,
      phone: companyPhone,
      email: companyEmail,
      taxId: companyTaxId,
      // logoDataUrl intentionally untouched — out of scope this phase.
    };
    if (JSON.stringify(old.company_info) !== JSON.stringify(newCompanyInfo)) {
      await setSetting("company_info", newCompanyInfo, user!.id, tx);
      await recordAudit(
        {
          userId: user!.id,
          action: "settings.update",
          entityType: "application_setting",
          entityId: "company_info",
          oldValue: old.company_info,
          newValue: newCompanyInfo,
        },
        tx,
      );
    }

    const newQuoteTerms = {
      paymentTerms: data.quotePaymentTerms.trim(),
      workTerms: data.quoteWorkTerms.trim(),
    };
    if (JSON.stringify(old.quote_default_terms) !== JSON.stringify(newQuoteTerms)) {
      await setSetting("quote_default_terms", newQuoteTerms, user!.id, tx);
      await recordAudit(
        {
          userId: user!.id,
          action: "settings.update",
          entityType: "application_setting",
          entityId: "quote_default_terms",
          oldValue: old.quote_default_terms,
          newValue: newQuoteTerms,
        },
        tx,
      );
    }

    const newThresholds = {
      measurementReminderMinutesBefore,
      installationReminderHoursBefore,
      checkDueSoonDays,
      staleRepairDays,
    };
    if (JSON.stringify(old.notification_thresholds) !== JSON.stringify(newThresholds)) {
      await setSetting("notification_thresholds", newThresholds, user!.id, tx);
      await recordAudit(
        {
          userId: user!.id,
          action: "settings.update",
          entityType: "application_setting",
          entityId: "notification_thresholds",
          oldValue: old.notification_thresholds,
          newValue: newThresholds,
        },
        tx,
      );
    }
  });

  revalidatePath("/settings");
  return { success: true };
}
