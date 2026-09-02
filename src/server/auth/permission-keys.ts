/**
 * The full permission catalogue (section 7). This is the ONLY place
 * permission keys are defined. Every authorization check in the app goes
 * through `can(user, PERMISSIONS.xxx)` — never a raw string, and NEVER a
 * check against a user's name/id. See src/server/auth/permissions.ts.
 *
 * Seeded verbatim into the `permissions` table by the seed script; the
 * admin Permissions screen only lets an admin grant/revoke these per user,
 * it does not let anyone invent new keys at runtime.
 */
export const PERMISSIONS = {
  VIEW_CUSTOMERS: "view_customers",
  CREATE_CUSTOMER: "create_customer",
  EDIT_CUSTOMER: "edit_customer",

  VIEW_ASSIGNED_JOBS: "view_assigned_jobs",
  VIEW_ALL_JOBS: "view_all_jobs",

  CREATE_MEASUREMENT: "create_measurement",
  EDIT_MEASUREMENT: "edit_measurement",

  CREATE_PRICE: "create_price",
  EDIT_PRICE: "edit_price",

  CREATE_QUOTE: "create_quote",
  SEND_QUOTE: "send_quote",
  CLOSE_DEAL: "close_deal",

  COLLECT_PAYMENT: "collect_payment",
  APPROVE_PAYMENT: "approve_payment",

  CREATE_PRODUCTION_ORDER: "create_production_order",
  APPROVE_FACTORY_PRICE: "approve_factory_price",

  ASSIGN_INSTALLER: "assign_installer",
  COMPLETE_INSTALLATION: "complete_installation",

  CREATE_REPAIR: "create_repair",

  VIEW_PROFITABILITY: "view_profitability",
  VIEW_JOB_COSTS: "view_job_costs",

  VIEW_TECHNICIAN_BALANCES: "view_technician_balances",
  MANAGE_TECHNICIAN_PAYMENTS: "manage_technician_payments",

  MANAGE_VEHICLES: "manage_vehicles",
  ADD_FUEL: "add_fuel",

  MANAGE_CHECKS: "manage_checks",

  APPROVE_REQUESTS: "approve_requests",

  MANAGE_USERS: "manage_users",
  MANAGE_PERMISSIONS: "manage_permissions",

  // --- Extensions beyond the literal section-7 list, same spirit ---
  // Section 77 (Settings) and section 62 (Audit log) both clearly need a
  // gate; the base spec names the *screens* but not a permission key for
  // them, so these two fill that gap rather than overloading MANAGE_USERS.
  MANAGE_SETTINGS: "manage_settings",
  VIEW_AUDIT_LOG: "view_audit_log",

  // Same gap as the two above, same fix: VIEW_JOB_COSTS only covers
  // *viewing* the cost ledger (see its catalogue description below) — the
  // base spec never named a permission for actually *recording* a job
  // cost. Factory costs are booked automatically by APPROVE_FACTORY_PRICE
  // and installer/daily-worker labor costs are booked automatically by
  // the compensation module, so neither needs a new key — but hardware /
  // external_contractor / aluminum_contractor / other costs had no entry
  // path at all until this key.
  MANAGE_JOB_COSTS: "manage_job_costs",
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

interface PermissionSeed {
  key: PermissionKey;
  label: string;
  description: string;
  category: string;
}

export const PERMISSION_CATALOGUE: PermissionSeed[] = [
  { key: PERMISSIONS.VIEW_CUSTOMERS, label: "عرض العملاء", description: "الاطلاع على ملفات العملاء وسجلّهم.", category: "العملاء" },
  { key: PERMISSIONS.CREATE_CUSTOMER, label: "إضافة عميل", description: "إضافة ملفات عملاء جديدة.", category: "العملاء" },
  { key: PERMISSIONS.EDIT_CUSTOMER, label: "تعديل عميل", description: "تعديل ملفات عملاء موجودة.", category: "العملاء" },

  { key: PERMISSIONS.VIEW_ASSIGNED_JOBS, label: "عرض المهام المُسندة", description: "الاطلاع على المهام المُسندة للمستخدم شخصياً.", category: "المهام" },
  { key: PERMISSIONS.VIEW_ALL_JOBS, label: "عرض جميع المهام", description: "الاطلاع على كل مهام النظام، وليس المُسندة فقط.", category: "المهام" },

  { key: PERMISSIONS.CREATE_MEASUREMENT, label: "إضافة قياس", description: "تسجيل زيارة قياس.", category: "القياس والتسعير" },
  { key: PERMISSIONS.EDIT_MEASUREMENT, label: "تعديل قياس", description: "تعديل قياس مُسجَّل سابقاً.", category: "القياس والتسعير" },
  { key: PERMISSIONS.CREATE_PRICE, label: "تحديد سعر", description: "تحديد أسعار بنود المهمة.", category: "القياس والتسعير" },
  { key: PERMISSIONS.EDIT_PRICE, label: "تعديل سعر", description: "تغيير أسعار محدَّدة سابقاً.", category: "القياس والتسعير" },

  { key: PERMISSIONS.CREATE_QUOTE, label: "إنشاء عرض سعر", description: "إعداد عرض سعر لمهمة.", category: "عروض الأسعار" },
  { key: PERMISSIONS.SEND_QUOTE, label: "إرسال عرض سعر", description: "إنشاء رابط التوقيع الآمن للعميل.", category: "عروض الأسعار" },
  { key: PERMISSIONS.CLOSE_DEAL, label: "إغلاق الصفقة", description: "تسجيل إغلاق الصفقة بواسطة هذا المستخدم (يؤثر على احتساب العمولة).", category: "عروض الأسعار" },

  { key: PERMISSIONS.COLLECT_PAYMENT, label: "تحصيل دفعة", description: "تسجيل دفعة مستلمة من العميل.", category: "المدفوعات" },
  { key: PERMISSIONS.APPROVE_PAYMENT, label: "اعتماد دفعة", description: "اعتماد دفعة عميل مسجَّلة.", category: "المدفوعات" },

  { key: PERMISSIONS.CREATE_PRODUCTION_ORDER, label: "إرسال أمر إنتاج", description: "إرسال المهمة إلى المصنع.", category: "الإنتاج" },
  { key: PERMISSIONS.APPROVE_FACTORY_PRICE, label: "اعتماد سعر المصنع", description: "اعتماد أو رفض سعر مرسَل من المصنع.", category: "الإنتاج" },

  { key: PERMISSIONS.ASSIGN_INSTALLER, label: "تعيين فني تركيب", description: "تعيين فنيين/مقاولين على مهمة أو بند منها.", category: "التركيب" },
  { key: PERMISSIONS.COMPLETE_INSTALLATION, label: "إكمال التركيب", description: "تسجيل انتهاء أعمال التركيب.", category: "التركيب" },

  { key: PERMISSIONS.CREATE_REPAIR, label: "فتح إصلاح", description: "فتح طلب إصلاح (تيكون) على مهمة.", category: "الإصلاحات" },

  { key: PERMISSIONS.VIEW_PROFITABILITY, label: "عرض الربحية", description: "الاطلاع على أرقام الإيراد والتكلفة وهامش الربح.", category: "الرؤية المالية" },
  { key: PERMISSIONS.VIEW_JOB_COSTS, label: "عرض تكاليف المهمة", description: "الاطلاع على سجل تكاليف المهمة.", category: "الرؤية المالية" },
  { key: PERMISSIONS.MANAGE_JOB_COSTS, label: "إدارة تكاليف المهمة", description: "تسجيل تكاليف مواد/مقاولين/تكاليف أخرى على المهمة.", category: "الرؤية المالية" },
  { key: PERMISSIONS.VIEW_TECHNICIAN_BALANCES, label: "عرض أرصدة الفنيين", description: "الاطلاع على سجل/رصيد أي فني.", category: "الرؤية المالية" },

  { key: PERMISSIONS.MANAGE_TECHNICIAN_PAYMENTS, label: "إدارة مستحقات الفنيين", description: "اعتماد تقارير دفعات الفنيين والتسويات.", category: "تعويض الفنيين" },

  { key: PERMISSIONS.MANAGE_VEHICLES, label: "إدارة المركبات", description: "إضافة/تعديل المركبات وسجل المسؤولية عنها.", category: "المركبات" },
  { key: PERMISSIONS.ADD_FUEL, label: "تسجيل وقود", description: "تسجيل عملية شراء وقود.", category: "المركبات" },

  { key: PERMISSIONS.MANAGE_CHECKS, label: "إدارة الشيكات", description: "تسجيل وتحديث الشيكات الواردة والصادرة.", category: "الشيكات" },

  { key: PERMISSIONS.APPROVE_REQUESTS, label: "اعتماد الطلبات", description: "البتّ في عناصر قائمة الموافقات العامة.", category: "الموافقات" },

  { key: PERMISSIONS.MANAGE_USERS, label: "إدارة المستخدمين", description: "إضافة/تعديل حسابات المستخدمين.", category: "الإدارة" },
  { key: PERMISSIONS.MANAGE_PERMISSIONS, label: "إدارة الصلاحيات", description: "منح/سحب صلاحيات أي حساب.", category: "الإدارة" },
  { key: PERMISSIONS.MANAGE_SETTINGS, label: "إدارة الإعدادات", description: "تعديل القواعد المالية: نسبة العمولة، معدلات التعويض، الحالات، الشروط.", category: "الإدارة" },
  { key: PERMISSIONS.VIEW_AUDIT_LOG, label: "عرض سجل التدقيق", description: "الاطلاع على سجل التغييرات الكامل في النظام.", category: "الإدارة" },
];
