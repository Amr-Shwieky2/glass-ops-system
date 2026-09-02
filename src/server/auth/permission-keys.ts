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
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

interface PermissionSeed {
  key: PermissionKey;
  label: string;
  description: string;
  category: string;
}

export const PERMISSION_CATALOGUE: PermissionSeed[] = [
  { key: PERMISSIONS.VIEW_CUSTOMERS, label: "View Customers", description: "See customer profiles and their history.", category: "Customers" },
  { key: PERMISSIONS.CREATE_CUSTOMER, label: "Create Customer", description: "Add new customer profiles.", category: "Customers" },
  { key: PERMISSIONS.EDIT_CUSTOMER, label: "Edit Customer", description: "Edit existing customer profiles.", category: "Customers" },

  { key: PERMISSIONS.VIEW_ASSIGNED_JOBS, label: "View Assigned Jobs", description: "See jobs the user is personally assigned to.", category: "Jobs" },
  { key: PERMISSIONS.VIEW_ALL_JOBS, label: "View All Jobs", description: "See every job in the system, not just assigned ones.", category: "Jobs" },

  { key: PERMISSIONS.CREATE_MEASUREMENT, label: "Create Measurement", description: "Record a measurement visit.", category: "Measurement & Pricing" },
  { key: PERMISSIONS.EDIT_MEASUREMENT, label: "Edit Measurement", description: "Edit a previously recorded measurement.", category: "Measurement & Pricing" },
  { key: PERMISSIONS.CREATE_PRICE, label: "Create Price", description: "Set prices on job items.", category: "Measurement & Pricing" },
  { key: PERMISSIONS.EDIT_PRICE, label: "Edit Price", description: "Change previously set prices.", category: "Measurement & Pricing" },

  { key: PERMISSIONS.CREATE_QUOTE, label: "Create Quote", description: "Build a quote for a job.", category: "Quotes" },
  { key: PERMISSIONS.SEND_QUOTE, label: "Send Quote", description: "Generate the customer's secure signing link.", category: "Quotes" },
  { key: PERMISSIONS.CLOSE_DEAL, label: "Close Deal", description: "Mark the deal as closed by this user (drives commission).", category: "Quotes" },

  { key: PERMISSIONS.COLLECT_PAYMENT, label: "Collect Payment", description: "Record a customer payment received.", category: "Payments" },
  { key: PERMISSIONS.APPROVE_PAYMENT, label: "Approve Payment", description: "Approve a recorded customer payment.", category: "Payments" },

  { key: PERMISSIONS.CREATE_PRODUCTION_ORDER, label: "Create Production Order", description: "Send a job to the factory.", category: "Production" },
  { key: PERMISSIONS.APPROVE_FACTORY_PRICE, label: "Approve Factory Price", description: "Approve or reject a factory's submitted price.", category: "Production" },

  { key: PERMISSIONS.ASSIGN_INSTALLER, label: "Assign Installer", description: "Assign technicians/contractors to a job or job item.", category: "Installation" },
  { key: PERMISSIONS.COMPLETE_INSTALLATION, label: "Complete Installation", description: "Mark installation work as completed.", category: "Installation" },

  { key: PERMISSIONS.CREATE_REPAIR, label: "Create Repair", description: "Open a repair/Tikun on a job.", category: "Repairs" },

  { key: PERMISSIONS.VIEW_PROFITABILITY, label: "View Profitability", description: "See revenue, cost and margin figures.", category: "Financial visibility" },
  { key: PERMISSIONS.VIEW_JOB_COSTS, label: "View Job Costs", description: "See the cost ledger of a job.", category: "Financial visibility" },
  { key: PERMISSIONS.VIEW_TECHNICIAN_BALANCES, label: "View Technician Balances", description: "See any technician's ledger/balance.", category: "Financial visibility" },

  { key: PERMISSIONS.MANAGE_TECHNICIAN_PAYMENTS, label: "Manage Technician Payments", description: "Approve technician payment reports and adjustments.", category: "Technician compensation" },

  { key: PERMISSIONS.MANAGE_VEHICLES, label: "Manage Vehicles", description: "Create/edit vehicles and responsibility history.", category: "Vehicles" },
  { key: PERMISSIONS.ADD_FUEL, label: "Add Fuel", description: "Log a fuel purchase.", category: "Vehicles" },

  { key: PERMISSIONS.MANAGE_CHECKS, label: "Manage Checks", description: "Record and update incoming/outgoing checks.", category: "Checks" },

  { key: PERMISSIONS.APPROVE_REQUESTS, label: "Approve Requests", description: "Decide items in the general approval queue.", category: "Approvals" },

  { key: PERMISSIONS.MANAGE_USERS, label: "Manage Users", description: "Create/edit user accounts.", category: "Administration" },
  { key: PERMISSIONS.MANAGE_PERMISSIONS, label: "Manage Permissions", description: "Grant/revoke permissions on any account.", category: "Administration" },
  { key: PERMISSIONS.MANAGE_SETTINGS, label: "Manage Settings", description: "Edit business rules: commission %, compensation rates, statuses, terms.", category: "Administration" },
  { key: PERMISSIONS.VIEW_AUDIT_LOG, label: "View Audit Log", description: "See the full change history across the system.", category: "Administration" },
];
