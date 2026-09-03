/**
 * Label dictionary for the CUSTOMER-FACING quote/signing surface only — the
 * quote PDF (src/server/pdf/quote-template.ts) and the public signing page
 * under src/app/public/q/[token]. The internal app UI stays Arabic-only and
 * does NOT use this file (see AGENTS.md).
 *
 * The Arabic set below is extracted byte-for-byte from the strings that
 * already existed in quote-template.ts, sign-form.tsx and page.tsx before
 * this file existed — nothing here changes what an Arabic quote says or
 * looks like. The Hebrew set is a fresh, professionally-worded translation
 * (not a literal word-for-word mirror of the Arabic wording) intended for
 * real customer-facing legal/commercial use.
 *
 * `language` mirrors the quotes table's `language` column ("ar" | "he",
 * defaulting to "ar" so every quote created before that column existed
 * keeps behaving exactly as it does today).
 */

export type QuoteLanguage = "ar" | "he";

export interface QuoteLabels {
  /** "عرض سعر" / "הצעת מחיר" — used as both the document title prefix
   * (followed by the quote number) and the public quote-summary heading. */
  documentTitlePrefix: string;
  /** "الإصدار" / "גרסה" */
  version: string;
  /** "التاريخ" / "תאריך" — template appends ": " + the formatted date. */
  date: string;
  /** "صالح حتى" / "בתוקף עד" — callers append their own punctuation. */
  validUntil: string;
  /** "بيانات العميل" / "פרטי הלקוח" */
  customerInfoHeading: string;
  /** "بيانات المهمة" / "פרטי העבודה" */
  jobInfoHeading: string;
  table: {
    /** "#" — identical in both languages. */
    index: string;
    /** "الوصف" / "תיאור" */
    description: string;
    /** "الكمية" / "כמות" */
    quantity: string;
    /** "سعر الوحدة" / "מחיר יחידה" */
    unitPrice: string;
    /** "الإجمالي" / "סה״כ" — the line-total column header (also reused,
     * same word, for the grand-total row below the table). */
    lineTotal: string;
  };
  /** Free-text unit codes on quoteItems.unit ("meter" | "unit" | "job" |
   * "day") mapped to a plain noun in this quote's language — "متر"/"מטר",
   * "قطعة"/"יחידה", "مهمة"/"עבודה", "يوم"/"יום". A unit not in the map
   * (including one already written out in this language) is returned
   * unchanged, so any existing or freely-typed unit text still displays. */
  unitLabel(unit: string | null | undefined): string;
  /** "المجموع الفرعي" / "סכום ביניים" */
  subtotal: string;
  /** "الإجمالي" / "סה״כ" — the grand-total row label. */
  total: string;
  /** "شروط الدفع" / "תנאי תשלום" */
  paymentTermsHeading: string;
  /** "شروط العمل" / "תנאי עבודה" */
  workTermsHeading: string;
  signature: {
    /** "توقيع العميل" / "חתימת הלקוח" — shown whether or not it's signed
     * yet. */
    sectionLabel: string;
    /** alt text on the signature image, "التوقيع" / "חתימה" */
    imageAlt: string;
    /** placeholder shown under the blank signature line before signing,
     * "الاسم والتاريخ" / "שם ותאריך" */
    unsignedPlaceholder: string;
  };
  /** "تحميل نسخة PDF" / "הורדת קובץ PDF" — the public page's PDF link. */
  pdfDownloadLabel: string;
  /** Fields on the public e-signature form (sign-form.tsx). Kept here per
   * spec even though this stage doesn't wire src/app/public itself. */
  signingForm: {
    /** "التوقيع والموافقة" / "חתימה ואישור" */
    formTitle: string;
    /** "الاسم" / "שם מלא" */
    fullNameLabel: string;
    /** "رقم الهاتف" / "טלפון" */
    phoneLabel: string;
    /** "رقم الهوية (اختياري)" / "ת.ז / ח.פ (אופציונלי)" — the Hebrew
     * label is worded to cover a business/company registration number
     * too (ח.פ), same field, no schema change; the Arabic label is left
     * exactly as it already reads today. */
    nationalIdLabel: string;
    /** inline example clarifying a business/company number is also
     * accepted, "مثال: 302345678 أو رقم الشركة" / "לדוגמה: 302345678 או
     * מספר ח.פ" — shown as the Input's placeholder, not a hard example
     * value (the field stays optional and free-form). */
    nationalIdPlaceholder: string;
    /** "العنوان" / "כתובת" */
    addressLabel: string;
    /** label above the signature pad, "التوقيع" / "חתימה" */
    signaturePadLabel: string;
    /** clear-signature button text on the pad, "مسح التوقيع" / "מחיקת
     * החתימה" — passed into the shared SignaturePad so it isn't
     * hardcoded Arabic on the Hebrew signing page. */
    clearSignatureLabel: string;
    /** agreement checkbox text */
    agreementText: string;
    /** submit button, idle state */
    submitLabel: string;
    /** submit button, pending state */
    submitPendingLabel: string;
  };
  statusNotices: {
    invalidLinkTitle: string;
    invalidLinkDescription: string;
    revokedTitle: string;
    revokedDescription: string;
    expiredTitle: string;
    expiredDescription: string;
    signedTitle: string;
    /** e.g. "تم التوقيع بتاريخ {date} بواسطة {name}. شكراً لك." */
    signedDescription: (signedDate: string, signerName: string) => string;
  };
}

const UNIT_MAP_AR: Record<string, string> = {
  meter: "متر",
  unit: "قطعة",
  job: "مهمة",
  day: "يوم",
};

const UNIT_MAP_HE: Record<string, string> = {
  meter: "מטר",
  unit: "יחידה",
  job: "עבודה",
  day: "יום",
};

const AR: QuoteLabels = {
  documentTitlePrefix: "عرض سعر",
  version: "الإصدار",
  date: "التاريخ",
  validUntil: "صالح حتى",
  customerInfoHeading: "بيانات العميل",
  jobInfoHeading: "بيانات المهمة",
  table: {
    index: "#",
    description: "الوصف",
    quantity: "الكمية",
    unitPrice: "سعر الوحدة",
    lineTotal: "الإجمالي",
  },
  unitLabel: (unit) => (unit ? (UNIT_MAP_AR[unit] ?? unit) : ""),
  subtotal: "المجموع الفرعي",
  total: "الإجمالي",
  paymentTermsHeading: "شروط الدفع",
  workTermsHeading: "شروط العمل",
  signature: {
    sectionLabel: "توقيع العميل",
    imageAlt: "التوقيع",
    unsignedPlaceholder: "الاسم والتاريخ",
  },
  pdfDownloadLabel: "تحميل نسخة PDF",
  signingForm: {
    formTitle: "التوقيع والموافقة",
    fullNameLabel: "الاسم",
    phoneLabel: "رقم الهاتف",
    nationalIdLabel: "رقم الهوية (اختياري)",
    nationalIdPlaceholder: "مثال: 302345678 أو رقم السجل التجاري",
    addressLabel: "العنوان",
    signaturePadLabel: "التوقيع",
    clearSignatureLabel: "مسح التوقيع",
    agreementText: "أوافق على بنود عرض السعر وشروط الدفع والعمل الموضحة أعلاه.",
    submitLabel: "توقيع والموافقة على العرض",
    submitPendingLabel: "جارٍ الحفظ...",
  },
  statusNotices: {
    invalidLinkTitle: "الرابط غير صالح",
    invalidLinkDescription:
      "تعذر العثور على عرض سعر مرتبط بهذا الرابط. تواصل معنا للحصول على رابط جديد.",
    revokedTitle: "تم إلغاء هذا الرابط",
    revokedDescription: "لم يعد هذا الرابط صالحاً للاستخدام. تواصل معنا للحصول على رابط جديد.",
    expiredTitle: "انتهت صلاحية هذا العرض",
    expiredDescription: "انتهت صلاحية عرض السعر هذا. تواصل معنا لإصدار عرض جديد.",
    signedTitle: "تم توقيع عرض السعر",
    signedDescription: (signedDate, signerName) =>
      `تم التوقيع بتاريخ ${signedDate} بواسطة ${signerName}. شكراً لك.`,
  },
};

const HE: QuoteLabels = {
  documentTitlePrefix: "הצעת מחיר",
  version: "גרסה",
  date: "תאריך",
  validUntil: "בתוקף עד",
  customerInfoHeading: "פרטי הלקוח",
  jobInfoHeading: "פרטי העבודה",
  table: {
    index: "#",
    description: "תיאור",
    quantity: "כמות",
    unitPrice: "מחיר יחידה",
    lineTotal: "סה״כ",
  },
  unitLabel: (unit) => (unit ? (UNIT_MAP_HE[unit] ?? unit) : ""),
  subtotal: "סכום ביניים",
  total: "סה״כ",
  paymentTermsHeading: "תנאי תשלום",
  workTermsHeading: "תנאי עבודה",
  signature: {
    sectionLabel: "חתימת הלקוח",
    imageAlt: "חתימה",
    unsignedPlaceholder: "שם ותאריך",
  },
  pdfDownloadLabel: "הורדת קובץ PDF",
  signingForm: {
    formTitle: "חתימה ואישור",
    fullNameLabel: "שם מלא",
    phoneLabel: "טלפון",
    nationalIdLabel: "ת.ז / ח.פ (אופציונלי)",
    nationalIdPlaceholder: "לדוגמה: 302345678 או מספר ח.פ",
    addressLabel: "כתובת",
    signaturePadLabel: "חתימה",
    clearSignatureLabel: "מחיקת החתימה",
    agreementText: "אני מאשר/ת את סעיפי הצעת המחיר ואת תנאי התשלום והעבודה המפורטים לעיל.",
    submitLabel: "חתימה ואישור ההצעה",
    submitPendingLabel: "שומר...",
  },
  statusNotices: {
    invalidLinkTitle: "הקישור אינו תקין",
    invalidLinkDescription: "לא ניתן היה לאתר הצעת מחיר המשויכת לקישור זה. אנא צרו קשר לקבלת קישור חדש.",
    revokedTitle: "קישור זה בוטל",
    revokedDescription: "קישור זה אינו תקף עוד לשימוש. אנא צרו קשר לקבלת קישור חדש.",
    expiredTitle: "תוקף הצעת המחיר פג",
    expiredDescription: "תוקפה של הצעת מחיר זו פג. אנא צרו קשר להנפקת הצעה חדשה.",
    signedTitle: "הצעת המחיר נחתמה",
    signedDescription: (signedDate, signerName) =>
      `ההצעה נחתמה בתאריך ${signedDate} על ידי ${signerName}. תודה רבה.`,
  },
};

/** Returns the full label set for one quote-facing language. Defaults to
 * "ar" wherever a caller has no explicit language yet (see quote-template.ts). */
export function getQuoteLabels(language: QuoteLanguage): QuoteLabels {
  return language === "he" ? HE : AR;
}
