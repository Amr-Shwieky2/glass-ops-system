/**
 * Pure data: the settings schema/defaults, split out from settings.ts so
 * the standalone seed script can import it without pulling in db/client.ts
 * (which opens a real Postgres pool at import time and is guarded with
 * `import "server-only"`, both incompatible with a plain tsx script).
 */
export interface SettingsSchema {
  commission_rate_percent: number;
  quote_validity_days: number;
  vehicle_usage_deduction_default: string; // Money
  company_info: {
    name: string;
    address: string;
    phone: string;
    email: string;
    taxId: string;
    logoDataUrl: string | null;
  };
  quote_default_terms: {
    paymentTerms: string;
    workTerms: string;
  };
  notification_thresholds: {
    measurementReminderMinutesBefore: number;
    installationReminderHoursBefore: number;
    checkDueSoonDays: number;
    staleRepairDays: number;
  };
}

export const SETTINGS_DEFAULTS: SettingsSchema = {
  commission_rate_percent: 10,
  quote_validity_days: 14,
  vehicle_usage_deduction_default: "300.00",
  company_info: {
    name: "زجاج المدينة",
    address: "",
    phone: "",
    email: "",
    taxId: "",
    logoDataUrl: null,
  },
  quote_default_terms: {
    paymentTerms:
      "50% دفعة مقدمة عند التوقيع، والباقي يُستحق عند إتمام التركيب.",
    workTerms:
      "القياسات نهائية بعد تأكيدها في الموقع. أي تغيير في البنود أو الكميات أو المواصفات بعد التوقيع يتطلب نسخة عرض سعر جديدة وتوقيعاً جديداً.",
  },
  notification_thresholds: {
    measurementReminderMinutesBefore: 60,
    installationReminderHoursBefore: 24,
    checkDueSoonDays: 3,
    staleRepairDays: 5,
  },
};
