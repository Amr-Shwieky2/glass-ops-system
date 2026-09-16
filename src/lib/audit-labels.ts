/**
 * Arabic labels for the audit trail (section 62 — admin/debugging screen,
 * but user-facing text there still follows the rest of the app in being
 * Arabic, not raw English DB identifiers). Sprint 9: before this file
 * existed, the audit log table rendered `row.action` (e.g.
 * `"job.add_field_note"`) and `row.entityType` (e.g. `"customer_payment"`)
 * verbatim — a real gap the master project instructions call out by name
 * ("audit actions").
 */

/**
 * action -> Arabic label, one entry per `action: "..."` literal actually
 * written by a recordAudit() call site across src/server (grepped
 * exhaustively, not a partial/representative sample) — keep this list in
 * sync when a new recordAudit call site is added.
 */
export const AUDIT_ACTION_LABEL_AR: Record<string, string> = {
  "appointment.arrive": "وصول إلى الموعد",
  "appointment.cancel": "إلغاء موعد",
  "appointment.complete_installation": "إكمال تركيب",
  "appointment.schedule": "جدولة موعد",
  "bonus_rule.create": "إنشاء قاعدة مكافأة",
  "bonus_rule.update": "تعديل قاعدة مكافأة",
  "cash_expense_report.create": "الإبلاغ عن مصروف ميداني",
  "cash_expense_report.decide": "اعتماد/رفض مصروف ميداني",
  "cash_transfer.confirm": "تأكيد تحويل نقدي",
  "cash_transfer.create": "إنشاء تحويل نقدي",
  "commission.estimate": "تقدير عمولة",
  "commission.finalize": "اعتماد عمولة نهائية",
  "compensation_rule.create": "إنشاء قاعدة تعويض",
  "compensation_rule.update": "تعديل قاعدة تعويض",
  "customer.create": "إنشاء عميل",
  "customer.update": "تعديل بيانات عميل",
  "customer_payment.create": "تسجيل دفعة عميل",
  "customer_payment.decide": "اعتماد/رفض دفعة عميل",
  "external_contractor.create": "إضافة مقاول خارجي",
  "external_contractor.set_active": "تفعيل/تعطيل مقاول خارجي",
  "external_contractor.update": "تعديل بيانات مقاول خارجي",
  "factory_public_link.regenerate": "إصدار رابط مصنع جديد",
  "factory_public_link.revoke": "إلغاء رابط المصنع",
  "fuel_log.create": "تسجيل وقود",
  "glass_type.create": "إضافة نوع زجاج",
  "glass_type.update": "تعديل نوع زجاج",
  "incoming_check.create": "تسجيل شيك وارد",
  "incoming_check.update_status": "تحديث حالة شيك وارد",
  "job.add_field_note": "إضافة ملاحظة ميدانية على مهمة",
  "job.cancel": "إلغاء مهمة",
  "job.close": "إغلاق مهمة",
  "job.create": "إنشاء مهمة",
  "job_assignment.create": "تعيين فني على مهمة",
  "job_assignment.remove": "إزالة تعيين فني",
  "job_cost.create": "تسجيل تكلفة مهمة",
  "job_cost.decide": "اعتماد/رفض تكلفة مهمة",
  "job_item.create": "إضافة بند عمل",
  "job_item.delete": "حذف بند عمل",
  "job_status.create": "إنشاء حالة مهمة",
  "job_status.update": "تعديل حالة مهمة",
  "measurement.create": "تسجيل قياس",
  "outgoing_check.create": "تسجيل شيك صادر",
  "outgoing_check.update_status": "تحديث حالة شيك صادر",
  "penalty_rule.create": "إنشاء قاعدة خصم",
  "penalty_rule.update": "تعديل قاعدة خصم",
  "production_request.approve": "اعتماد طلب إنتاج",
  "production_request.auto_create_failed": "فشل إنشاء طلب إنتاج تلقائي",
  "production_request.auto_create_skipped_terminal_job":
    "تخطي إنشاء طلب إنتاج (المهمة منتهية)",
  "production_request.create": "إنشاء طلب إنتاج",
  "production_request.factory_submit": "تسعير من المصنع",
  "production_request.reject": "رفض طلب إنتاج",
  "quote.ai_draft_generated": "توليد مسودة عرض سعر بالذكاء الاصطناعي",
  "quote.auto_convert_failed": "فشل التحويل التلقائي إلى مهمة",
  "quote.auto_convert_skipped_terminal_job": "تخطي التحويل التلقائي (المهمة منتهية)",
  "quote.convert_to_job": "تحويل عرض سعر إلى مهمة",
  "quote.create": "إنشاء عرض سعر",
  "quote.send": "إرسال عرض سعر",
  "quote.sign": "توقيع عرض سعر",
  "quote.version_create": "إنشاء نسخة جديدة من عرض السعر",
  "repair.create": "الإبلاغ عن إصلاح",
  "repair.status_change": "تغيير حالة إصلاح",
  "settings.update": "تعديل الإعدادات العامة",
  "technician_ledger_entry.allocate_installation_earning": "تخصيص تعويض تركيب",
  "technician_ledger_entry.decide": "اعتماد/رفض قيد فني",
  "technician_ledger_entry.record_adjustment": "تسجيل تسوية يدوية",
  "technician_ledger_entry.record_bonus": "تسجيل مكافأة",
  "technician_ledger_entry.record_daily_wage": "تسجيل أجرة يومية",
  "technician_ledger_entry.record_overtime": "تسجيل ساعات إضافية",
  "technician_ledger_entry.record_penalty": "تسجيل غرامة",
  "technician_ledger_entry.report_payment": "الإبلاغ عن دفعة ذاتية",
  "technician_ledger_entry.vehicle_usage_deduction": "خصم استخدام مركبة",
  "user.create": "إنشاء مستخدم",
  "user.password_reset": "إعادة تعيين كلمة مرور",
  "user.status_change": "تفعيل/تعطيل مستخدم",
  "user.update": "تعديل بيانات مستخدم",
  "user_permission.grant": "منح صلاحية",
  "user_permission.revoke": "سحب صلاحية",
  "vehicle.assign_responsibility": "إسناد مسؤولية مركبة",
  "vehicle.create": "إضافة مركبة",
  "vehicle.update": "تعديل بيانات مركبة",
  "vehicle_maintenance_cost.create": "تسجيل تكلفة صيانة مركبة",
  "work_type.create": "إضافة نوع عمل",
  "work_type.update": "تعديل نوع عمل",
};

/**
 * entityType -> Arabic label, one entry per `entityType: "..."` literal
 * actually written by a recordAudit() call site — the single source of
 * truth for both the filter dropdown (audit-filters.tsx) and the results
 * table (page.tsx), which previously kept their own separate copy (the
 * filter was translated, the table showing the same values was not).
 */
export const ENTITY_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "user", label: "مستخدم" },
  { value: "customer", label: "عميل" },
  { value: "job", label: "مهمة" },
  { value: "job_status", label: "حالة مهمة" },
  { value: "work_type", label: "نوع عمل" },
  { value: "glass_type", label: "نوع زجاج" },
  { value: "quote", label: "عرض سعر" },
  { value: "customer_payment", label: "دفعة عميل" },
  { value: "production_request", label: "طلب إنتاج" },
  { value: "factory_submission", label: "تسعير المصنع" },
  { value: "factory_public_link", label: "رابط المصنع" },
  { value: "job_cost", label: "تكلفة مهمة" },
  { value: "technician_ledger_entry", label: "قيد فني" },
  { value: "compensation_rule", label: "قاعدة تعويض" },
  { value: "penalty_rule", label: "قاعدة خصم" },
  { value: "bonus_rule", label: "قاعدة مكافأة" },
  { value: "vehicle", label: "مركبة" },
  { value: "vehicle_maintenance_cost", label: "تكلفة صيانة مركبة" },
  { value: "fuel_log", label: "سجل وقود" },
  { value: "incoming_check", label: "شيك وارد" },
  { value: "outgoing_check", label: "شيك صادر" },
  { value: "cash_transfer", label: "تحويل نقدي" },
  { value: "cash_expense_report", label: "مصروف ميداني" },
  { value: "commission", label: "عمولة" },
  { value: "repair", label: "إصلاح" },
  { value: "external_contractor", label: "مقاول خارجي" },
  { value: "appointment", label: "موعد" },
  { value: "application_setting", label: "إعداد عام" },
];

const ENTITY_TYPE_LABEL_AR: Record<string, string> = Object.fromEntries(
  ENTITY_TYPE_OPTIONS.map((opt) => [opt.value, opt.label]),
);

/** Best-effort readable fallback for an action/field key this map doesn't
 * (yet) cover — "job_cost.some_new_action" -> "job cost some new action".
 * Not a translation, just markedly more readable than a raw dotted/
 * underscored English slug while the map above catches up. */
function humanizeUnknownKey(key: string): string {
  return key.replace(/[._]/g, " ").trim();
}

export function formatAuditAction(action: string): string {
  return AUDIT_ACTION_LABEL_AR[action] ?? humanizeUnknownKey(action);
}

export function formatEntityType(entityType: string): string {
  return ENTITY_TYPE_LABEL_AR[entityType] ?? humanizeUnknownKey(entityType);
}

/**
 * Arabic labels for the most commonly audited database column names, used
 * by the audit log's change-diff viewer so the JSON keys inside a diff
 * read as words an Arabic-speaking admin recognizes, not raw camelCase.
 * Deliberately NOT exhaustive over every column of every audited table —
 * that set is large and keeps growing; an unmapped key falls back to
 * humanizeUnknownKey (spaced-out camelCase) rather than blocking on full
 * coverage. Covers the fields that actually appear most often across this
 * codebase's recordAudit() newValue/oldValue payloads.
 */
const FIELD_LABEL_AR: Record<string, string> = {
  id: "المعرف",
  name: "الاسم",
  phone: "الهاتف",
  email: "البريد الإلكتروني",
  address: "العنوان",
  notes: "ملاحظات",
  note: "ملاحظة",
  status: "الحالة",
  statusId: "الحالة",
  isActive: "مفعّل",
  isTerminal: "حالة نهائية",
  amount: "المبلغ",
  method: "طريقة الدفع",
  approvalStatus: "حالة الاعتماد",
  paymentDate: "تاريخ الدفعة",
  dueDate: "تاريخ الاستحقاق",
  checkNumber: "رقم الشيك",
  bank: "البنك",
  salePriceTotal: "إجمالي سعر البيع",
  title: "العنوان",
  jobId: "معرف المهمة",
  jobNumber: "رقم المهمة",
  customerId: "معرف العميل",
  quantity: "الكمية",
  unit: "الوحدة",
  description: "الوصف",
  category: "الفئة",
  appointmentId: "معرّف الموعد",
  jobItemId: "معرّف البند",
  jobItemIds: "معرّفات البنود",
  photoTaken: "تم توثيق الصور",
  paymentAmount: "مبلغ الدفعة",
  paymentCollected: "تم تحصيل الدفعة",
  plateNumber: "رقم اللوحة",
  fuelType: "نوع الوقود",
  estimatedValue: "القيمة التقديرية",
  liters: "اللترات",
  odometerReading: "قراءة العداد",
  nationalId: "رقم الهوية",
  googleMapsUrl: "رابط خرائط جوجل",
  latitude: "خط العرض",
  longitude: "خط الطول",
  createdAt: "تاريخ الإنشاء",
  updatedAt: "تاريخ التعديل",
  approvedAt: "تاريخ الاعتماد",
  approvedByUserId: "معتمِد بواسطة",
  createdByUserId: "أُنشئ بواسطة",
  rejectedAt: "تاريخ الرفض",
  rejectionReason: "سبب الرفض",
  vendorUserId: "الفني",
  receivedByUserId: "المستلِم",
  responsibleUserId: "المسؤول",
  defaultResponsibleUserId: "المسؤول الافتراضي",
  scheduledStart: "بداية الموعد",
  scheduledEnd: "نهاية الموعد",
  location: "الموقع",
  type: "النوع",
  language: "اللغة",
  validUntil: "صالح حتى",
  requestNumber: "رقم الطلب",
  estimatedReadyDate: "الجاهزية المتوقعة",
  expiresAt: "تاريخ الانتهاء",
  revokedAt: "تاريخ الإلغاء",
  permissionKey: "الصلاحية",
  role: "الدور",
  dailyWageAmount: "الأجرة اليومية",
  defaultVehicleId: "المركبة الافتراضية",
  key: "المفتاح",
  value: "القيمة",
  rateUsed: "المعدّل المستخدَم",
  hours: "عدد الساعات",
};

/** Applies FIELD_LABEL_AR to every own key of a plain object, one level
 * deep (the shape every recordAudit newValue/oldValue payload actually
 * uses — a flat field->value map, never nested) — an unmapped key keeps
 * its own name (humanized), never disappears. */
export function translateFieldNames(value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, v]) => [
      FIELD_LABEL_AR[key] ?? humanizeUnknownKey(key),
      v,
    ]),
  );
}
