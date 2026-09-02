/**
 * Seed / demo data (section 86). Safe to re-run: truncates all
 * application tables first, then rebuilds a consistent, richly
 * interconnected demo dataset — including the full Ahmad end-to-end
 * scenario from section 72, arithmetic verified to match the spec's own
 * example numbers exactly (Total Cost 5,900 / Gross Profit 6,100 /
 * Commission 610).
 *
 * Run with: npm run db:seed
 */
import "dotenv/config";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import * as schema from "./schema";
import { PERMISSIONS, PERMISSION_CATALOGUE } from "@/server/auth/permission-keys";
import { hashPassword } from "@/server/auth/password";
import { generateSecureToken } from "@/server/tokens";
import { SETTINGS_DEFAULTS } from "@/server/settings-defaults";

const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}
function daysFromNow(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
}
function dateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema });

  console.log("Truncating existing data...");
  await db.execute(sql`
    TRUNCATE TABLE
      audit_logs, notifications, approval_requests,
      commissions, technician_ledger_entries,
      repairs,
      fuel_logs, vehicle_responsibility_history, vehicles,
      outgoing_checks, incoming_checks,
      cash_transfers, cash_transactions, cash_accounts,
      customer_payments, job_costs,
      factory_public_links, factory_submissions, production_requests,
      quote_public_links, quote_signatures, quote_items, quote_versions, quotes,
      appointment_assignees, appointments,
      job_assignments, measurements, job_items, jobs,
      external_contractors,
      application_settings, number_sequences, bonus_rules, penalty_rules,
      compensation_rules, work_types, job_statuses,
      customers,
      sessions, user_permissions, permissions, users
    RESTART IDENTITY CASCADE
  `);

  console.log("Seeding permissions...");
  await db.insert(schema.permissions).values(PERMISSION_CATALOGUE);

  console.log("Seeding users...");
  const passwordHash = await hashPassword("password123");
  const [amr, mohammad, issam, basel] = await db
    .insert(schema.users)
    .values([
      { name: "عمرو", phone: "+972501111111", email: "amr@example.com", passwordHash },
      { name: "محمد", phone: "+972502222222", email: "mohammad@example.com", passwordHash },
      { name: "عصام", phone: "+972503333333", email: "issam@example.com", passwordHash },
      { name: "باسل", phone: "+972504444444", email: "basel@example.com", passwordHash, dailyWageAmount: "450.00" },
    ])
    .returning();

  const ALL_KEYS = PERMISSION_CATALOGUE.map((p) => p.key);
  const MOHAMMAD_KEYS = [
    PERMISSIONS.VIEW_CUSTOMERS, PERMISSIONS.CREATE_CUSTOMER, PERMISSIONS.EDIT_CUSTOMER,
    PERMISSIONS.VIEW_ALL_JOBS, PERMISSIONS.VIEW_ASSIGNED_JOBS,
    PERMISSIONS.CREATE_MEASUREMENT, PERMISSIONS.EDIT_MEASUREMENT,
    PERMISSIONS.CREATE_PRICE, PERMISSIONS.EDIT_PRICE,
    PERMISSIONS.CREATE_QUOTE, PERMISSIONS.SEND_QUOTE, PERMISSIONS.CLOSE_DEAL,
    PERMISSIONS.COLLECT_PAYMENT, PERMISSIONS.APPROVE_PAYMENT,
    PERMISSIONS.CREATE_PRODUCTION_ORDER, PERMISSIONS.APPROVE_FACTORY_PRICE,
    PERMISSIONS.ASSIGN_INSTALLER,
    PERMISSIONS.VIEW_PROFITABILITY, PERMISSIONS.VIEW_JOB_COSTS,
    PERMISSIONS.VIEW_TECHNICIAN_BALANCES, PERMISSIONS.MANAGE_TECHNICIAN_PAYMENTS,
    PERMISSIONS.APPROVE_REQUESTS, PERMISSIONS.MANAGE_CHECKS,
  ];
  const ISSAM_KEYS = [
    PERMISSIONS.VIEW_CUSTOMERS, PERMISSIONS.VIEW_ASSIGNED_JOBS,
    PERMISSIONS.CREATE_MEASUREMENT, PERMISSIONS.EDIT_MEASUREMENT,
    PERMISSIONS.CREATE_PRICE, PERMISSIONS.EDIT_PRICE,
    PERMISSIONS.SEND_QUOTE, PERMISSIONS.CLOSE_DEAL,
    PERMISSIONS.COLLECT_PAYMENT,
    PERMISSIONS.COMPLETE_INSTALLATION, PERMISSIONS.ADD_FUEL,
  ];
  const BASEL_KEYS = [
    PERMISSIONS.VIEW_CUSTOMERS, PERMISSIONS.VIEW_ASSIGNED_JOBS,
    PERMISSIONS.CREATE_MEASUREMENT,
    PERMISSIONS.COMPLETE_INSTALLATION, PERMISSIONS.COLLECT_PAYMENT,
    PERMISSIONS.ADD_FUEL,
  ];

  await db.insert(schema.userPermissions).values([
    ...ALL_KEYS.map((key) => ({ userId: amr.id, permissionKey: key, grantedByUserId: amr.id })),
    ...MOHAMMAD_KEYS.map((key) => ({ userId: mohammad.id, permissionKey: key, grantedByUserId: amr.id })),
    ...ISSAM_KEYS.map((key) => ({ userId: issam.id, permissionKey: key, grantedByUserId: amr.id })),
    ...BASEL_KEYS.map((key) => ({ userId: basel.id, permissionKey: key, grantedByUserId: amr.id })),
  ]);

  console.log("Seeding job statuses...");
  const statusDefs = [
    ["new_lead", "New Lead", "عميل محتمل جديد", false],
    ["measurement_scheduled", "Measurement Scheduled", "تحديد موعد القياس", false],
    ["measurement_completed", "Measurement Completed", "تم القياس", false],
    ["waiting_for_pricing", "Waiting for Pricing", "بانتظار التسعير", false],
    ["quote_sent", "Quote Sent", "تم إرسال عرض السعر", false],
    ["waiting_for_customer_approval", "Waiting for Customer Approval", "بانتظار موافقة العميل", false],
    ["quote_signed", "Quote Signed", "تم توقيع عرض السعر", false],
    ["waiting_for_production", "Waiting for Production", "بانتظار الإنتاج", false],
    ["in_production", "In Production", "قيد الإنتاج", false],
    ["ready_from_factory", "Ready from Factory", "جاهز من المصنع", false],
    ["installation_scheduled", "Installation Scheduled", "تحديد موعد التركيب", false],
    ["installation_in_progress", "Installation In Progress", "التركيب قيد التنفيذ", false],
    ["installed", "Installed", "تم التركيب", false],
    ["repair_needed", "Repair Needed", "يحتاج إصلاح", false],
    ["repair_scheduled", "Repair Scheduled", "تحديد موعد الإصلاح", false],
    ["completed", "Completed", "مكتمل", true],
    ["cancelled", "Cancelled", "ملغى", true],
  ] as const;
  const statusRows = await db
    .insert(schema.jobStatuses)
    .values(
      statusDefs.map(([key, labelEn, labelAr, isTerminal], i) => ({
        key,
        labelEn,
        labelAr,
        isTerminal,
        sortOrder: i,
      })),
    )
    .returning();
  const statusByKey = Object.fromEntries(statusRows.map((s) => [s.key, s]));

  console.log("Seeding work types...");
  const workTypeDefs = [
    ["adhesive", "Adhesive", "لصق", "meter"],
    ["glass_railing", "Glass Railing", "درابزين زجاج", "meter"],
    ["fixed_glass", "Fixed Glass", "زجاج ثابت", "meter"],
    ["kitchen_glass", "Kitchen Glass", "زجاج مطبخ", "meter"],
    ["shower", "Shower", "كابينة استحمام", "unit"],
    ["mirror", "Mirror", "مرآة", "meter"],
    ["door", "Door", "باب", "unit"],
    ["aluminum", "Aluminum", "ألمنيوم", "unit"],
    ["storefront", "Storefront", "واجهة محل", "job"],
    ["other", "Other", "أخرى", "unit"],
  ] as const;
  const workTypeRows = await db
    .insert(schema.workTypes)
    .values(
      workTypeDefs.map(([key, labelEn, labelAr, defaultUnit], i) => ({
        key,
        labelEn,
        labelAr,
        defaultUnit,
        sortOrder: i,
      })),
    )
    .returning();
  const workTypeByKey = Object.fromEntries(workTypeRows.map((w) => [w.key, w]));

  console.log("Seeding compensation/penalty/bonus rules...");
  await db.insert(schema.compensationRules).values([
    { label: "Adhesive", unit: "meter", amount: "100.00", workTypeId: workTypeByKey.adhesive.id },
    { label: "Glass Railing", unit: "meter", amount: "250.00", workTypeId: workTypeByKey.glass_railing.id },
    { label: "Fixed Glass", unit: "meter", amount: "130.00", workTypeId: workTypeByKey.fixed_glass.id },
    { label: "Kitchen Glass", unit: "meter", amount: "250.00", workTypeId: workTypeByKey.kitchen_glass.id },
    { label: "Shower", unit: "unit", amount: "500.00", workTypeId: workTypeByKey.shower.id },
    { label: "Ambition Open", unit: "unit", amount: "300.00" },
    { label: "Ambition Closed", unit: "unit", amount: "500.00" },
    { label: "Storefront", unit: "job", amount: "1000.00", workTypeId: workTypeByKey.storefront.id },
    { label: "Mirrors", unit: "meter", amount: "150.00", workTypeId: workTypeByKey.mirror.id },
    { label: "Jack Replacement", unit: "unit", amount: "300.00" },
    { label: "Door Installation with Existing Jack", unit: "unit", amount: "500.00", workTypeId: workTypeByKey.door.id },
    { label: "Workshop Day with Mohammad", unit: "day", amount: "1000.00" },
  ]);
  await db.insert(schema.penaltyRules).values([
    { label: "Late to Customer", defaultAmount: "100.00", description: "Per hour late." },
    { label: "Did not attend scheduled workshop", defaultAmount: "250.00" },
    { label: "No official uniform", defaultAmount: "300.00" },
    { label: "No photo/video documentation", defaultAmount: "100.00" },
    { label: "Customer complaint about work or behavior", defaultAmount: "600.00" },
  ]);
  await db.insert(schema.bonusRules).values([
    { label: "Customer thank-you video/message", defaultAmount: "50.00" },
  ]);

  console.log("Seeding application settings...");
  await db.insert(schema.applicationSettings).values(
    (Object.keys(SETTINGS_DEFAULTS) as (keyof typeof SETTINGS_DEFAULTS)[]).map((key) => ({
      key,
      value: SETTINGS_DEFAULTS[key],
      updatedByUserId: amr.id,
    })),
  );

  console.log("Seeding vehicles...");
  const [mercedes, transitVan] = await db
    .insert(schema.vehicles)
    .values([
      { name: "מרצדס / Mercedes", plateNumber: "12-345-67", fuelType: "diesel", defaultResponsibleUserId: issam.id, estimatedValue: "120000.00" },
      { name: "Transit Van", plateNumber: "98-765-43", fuelType: "diesel", defaultResponsibleUserId: mohammad.id, estimatedValue: "80000.00" },
    ])
    .returning();
  await db.insert(schema.vehicleResponsibilityHistory).values([
    { vehicleId: mercedes.id, userId: issam.id, startDate: dateOnly(daysAgo(240)) },
    { vehicleId: transitVan.id, userId: mohammad.id, startDate: dateOnly(daysAgo(240)) },
  ]);
  await db
    .update(schema.users)
    .set({ defaultVehicleId: mercedes.id })
    .where(sql`${schema.users.id} = ${issam.id}`);
  await db.insert(schema.fuelLogs).values([
    { vehicleId: mercedes.id, addedByUserId: basel.id, amount: "300.00", fuelType: "diesel", liters: "45.5", loggedAt: daysAgo(6), notes: "Fill-up before Ahmad job installation." },
    { vehicleId: transitVan.id, addedByUserId: mohammad.id, amount: "220.00", fuelType: "diesel", liters: "33", loggedAt: daysAgo(20) },
  ]);

  console.log("Seeding cash accounts...");
  const [companyCash, amrCash, mohammadCash, issamCash, baselCash] = await db
    .insert(schema.cashAccounts)
    .values([
      { ownerType: "company" },
      { ownerType: "user", ownerUserId: amr.id },
      { ownerType: "user", ownerUserId: mohammad.id },
      { ownerType: "user", ownerUserId: issam.id },
      { ownerType: "user", ownerUserId: basel.id },
    ])
    .returning();

  // ---------------------------------------------------------------------
  // Job 1: أحمد يوسف (Ahmad Yousef) — the full section-72 acceptance
  // scenario, arithmetic verified: Total Cost 5,900 / Gross Profit 6,100 /
  // Commission 610, matching the spec's own worked example exactly.
  // ---------------------------------------------------------------------
  console.log("Seeding Job 1: Ahmad (full scenario)...");
  const [ahmad] = await db
    .insert(schema.customers)
    .values({
      name: "أحمد يوسف",
      phone: "+972505551001",
      nationalId: "300123456",
      address: "شارع الزيتون 14، الناصرة",
      createdByUserId: mohammad.id,
    })
    .returning();

  const [ahmadJob] = await db
    .insert(schema.jobs)
    .values({
      jobNumber: "JOB-2026-0001",
      customerId: ahmad.id,
      statusId: statusByKey.completed.id,
      title: "Shower + Glass Railing",
      address: ahmad.address,
      measuredByUserId: basel.id,
      pricingResponsibleUserId: mohammad.id,
      dealClosedByUserId: mohammad.id,
      salePriceTotal: "12000.00",
      createdByUserId: mohammad.id,
      createdAt: daysAgo(12),
      closedAt: daysAgo(1),
    })
    .returning();

  await db.insert(schema.measurements).values({
    jobId: ahmadJob.id,
    measuredByUserId: basel.id,
    measuredAt: daysAgo(11),
    details: "Shower opening 90x200cm. Staircase railing: 5 linear meters.",
    photosTaken: true,
    pricingResponsibleUserId: mohammad.id,
  });

  const [ahmadQuote] = await db
    .insert(schema.quotes)
    .values({
      quoteNumber: "Q-2026-0001",
      customerId: ahmad.id,
      jobId: ahmadJob.id,
      status: "signed",
      createdByUserId: mohammad.id,
      createdAt: daysAgo(10),
    })
    .returning();
  const [ahmadQuoteV1] = await db
    .insert(schema.quoteVersions)
    .values({
      quoteId: ahmadQuote.id,
      versionNumber: 1,
      paymentTerms: SETTINGS_DEFAULTS.quote_default_terms.paymentTerms,
      workTerms: SETTINGS_DEFAULTS.quote_default_terms.workTerms,
      validUntil: dateOnly(daysAgo(10 - 14)),
      subtotal: "12000.00",
      total: "12000.00",
      isSigned: true,
      createdByUserId: mohammad.id,
      createdAt: daysAgo(10),
    })
    .returning();
  await db.insert(schema.quoteItems).values([
    { quoteVersionId: ahmadQuoteV1.id, workTypeId: workTypeByKey.shower.id, description: "Shower enclosure, clear tempered glass", quantity: "1", unit: "unit", unitPrice: "7000.00", lineTotal: "7000.00", sortOrder: 0 },
    { quoteVersionId: ahmadQuoteV1.id, workTypeId: workTypeByKey.glass_railing.id, description: "Staircase glass railing", quantity: "5", unit: "meter", unitPrice: "1000.00", lineTotal: "5000.00", sortOrder: 1 },
  ]);
  await db.insert(schema.quoteSignatures).values({
    quoteVersionId: ahmadQuoteV1.id,
    signedAt: daysAgo(9),
    customerNameAtSigning: "أحمد يوسف",
    customerPhoneAtSigning: ahmad.phone,
    customerNationalIdAtSigning: ahmad.nationalId,
    customerAddressAtSigning: ahmad.address,
    agreedToTerms: true,
    signatureImage: TINY_PNG,
  });
  await db
    .update(schema.quotes)
    .set({ currentVersionId: ahmadQuoteV1.id, signedVersionId: ahmadQuoteV1.id })
    .where(sql`${schema.quotes.id} = ${ahmadQuote.id}`);
  await db
    .update(schema.jobs)
    .set({ quoteId: ahmadQuote.id, sourceQuoteVersionId: ahmadQuoteV1.id })
    .where(sql`${schema.jobs.id} = ${ahmadJob.id}`);

  const [ahmadShowerItem, ahmadRailingItem] = await db
    .insert(schema.jobItems)
    .values([
      { jobId: ahmadJob.id, workTypeId: workTypeByKey.shower.id, description: "Shower enclosure, clear tempered glass", quantity: "1", unit: "unit", salePrice: "7000.00", status: "installed" },
      { jobId: ahmadJob.id, workTypeId: workTypeByKey.glass_railing.id, description: "Staircase glass railing", quantity: "5", unit: "meter", salePrice: "5000.00", status: "installed" },
    ])
    .returning();

  const [ahmadProdRequest] = await db
    .insert(schema.productionRequests)
    .values({
      jobId: ahmadJob.id,
      requestedByUserId: mohammad.id,
      details: "Shower glass 90x200cm + 5m railing glass panels, standard clear tempered.",
      status: "approved",
      estimatedReadyDate: dateOnly(daysAgo(6)),
      createdAt: daysAgo(9),
    })
    .returning();
  await db.insert(schema.factorySubmissions).values({
    productionRequestId: ahmadProdRequest.id,
    submittedPrice: "3200.00",
    notes: "Standard tempered glass, 10mm.",
    estimatedReadyDate: dateOnly(daysAgo(6)),
    submittedAt: daysAgo(8),
    approvalStatus: "approved",
    approvedByUserId: mohammad.id,
    approvedAt: daysAgo(8),
  });

  const measurementAppt = await db.insert(schema.appointments).values({
    jobId: ahmadJob.id,
    type: "measurement",
    scheduledStart: daysAgo(11),
    scheduledEnd: daysAgo(11),
    location: ahmad.address,
    status: "completed",
    createdByUserId: mohammad.id,
  }).returning();
  const installAppt = await db.insert(schema.appointments).values({
    jobId: ahmadJob.id,
    type: "installation",
    scheduledStart: daysAgo(5),
    location: ahmad.address,
    status: "completed",
    notes: "Bring extra silicone sealant.",
    createdByUserId: mohammad.id,
  }).returning();
  await db.insert(schema.appointmentAssignees).values([
    { appointmentId: measurementAppt[0].id, userId: basel.id },
    { appointmentId: installAppt[0].id, userId: issam.id },
    { appointmentId: installAppt[0].id, userId: basel.id },
  ]);
  await db.insert(schema.jobAssignments).values([
    { jobId: ahmadJob.id, userId: issam.id, role: "installer", createdByUserId: mohammad.id },
    { jobId: ahmadJob.id, userId: basel.id, role: "installer", createdByUserId: mohammad.id },
  ]);

  // Technician ledger (labor) + matching job cost rows, linked.
  const [issamLedger] = await db.insert(schema.technicianLedgerEntries).values({
    userId: issam.id,
    entryType: "installation_earning",
    amount: "1250.00",
    relatedJobId: ahmadJob.id,
    description: "Shower + railing installation — Ahmad job",
    approvalStatus: "approved",
    createdByUserId: mohammad.id,
    approvedByUserId: mohammad.id,
    approvedAt: daysAgo(5),
    createdAt: daysAgo(5),
  }).returning();
  const [baselLedger] = await db.insert(schema.technicianLedgerEntries).values({
    userId: basel.id,
    entryType: "daily_wage",
    amount: "450.00",
    relatedJobId: ahmadJob.id,
    description: "Installation day — Ahmad job",
    approvalStatus: "approved",
    createdByUserId: mohammad.id,
    approvedByUserId: mohammad.id,
    approvedAt: daysAgo(5),
    createdAt: daysAgo(5),
  }).returning();

  await db.insert(schema.jobCosts).values([
    { jobId: ahmadJob.id, category: "factory_glass", amount: "3200.00", description: "Approved factory production cost.", status: "approved", createdByUserId: mohammad.id, approvedByUserId: mohammad.id, approvedAt: daysAgo(8), incurredAt: dateOnly(daysAgo(8)) },
    { jobId: ahmadJob.id, category: "hardware", amount: "1000.00", description: "Clamps, hinges, silicone.", status: "approved", createdByUserId: mohammad.id, approvedByUserId: mohammad.id, approvedAt: daysAgo(6), incurredAt: dateOnly(daysAgo(6)) },
    { jobId: ahmadJob.id, jobItemId: ahmadRailingItem.id, category: "installer_labor", amount: "1250.00", description: "Issam — installation labor.", vendorUserId: issam.id, ledgerEntryId: issamLedger.id, status: "approved", createdByUserId: mohammad.id, approvedByUserId: mohammad.id, approvedAt: daysAgo(5), incurredAt: dateOnly(daysAgo(5)) },
    { jobId: ahmadJob.id, jobItemId: ahmadShowerItem.id, category: "daily_worker_labor", amount: "450.00", description: "Basel — installation day labor.", vendorUserId: basel.id, ledgerEntryId: baselLedger.id, status: "approved", createdByUserId: mohammad.id, approvedByUserId: mohammad.id, approvedAt: daysAgo(5), incurredAt: dateOnly(daysAgo(5)) },
  ]);

  // Commission: 10% of 6,100 gross profit = 610.
  const [mohammadCommissionLedger] = await db.insert(schema.technicianLedgerEntries).values({
    userId: mohammad.id,
    entryType: "commission",
    amount: "610.00",
    relatedJobId: ahmadJob.id,
    description: "Deal-closing commission — Ahmad job",
    approvalStatus: "approved",
    createdByUserId: amr.id,
    approvedByUserId: amr.id,
    approvedAt: daysAgo(1),
    createdAt: daysAgo(1),
  }).returning();
  await db.insert(schema.commissions).values({
    jobId: ahmadJob.id,
    closedByUserId: mohammad.id,
    ratePercent: "10.00",
    estimatedGrossProfit: "6100.00",
    estimatedAmount: "610.00",
    finalGrossProfit: "6100.00",
    finalAmount: "610.00",
    status: "finalized",
    finalizedAt: daysAgo(1),
    ledgerEntryId: mohammadCommissionLedger.id,
  });

  // Customer payments: 3,000 deposit (Mohammad) + 5,000 mid-job (Issam) +
  // 4,000 final (bank transfer) = 12,000 = fully paid.
  const [depositPayment] = await db.insert(schema.customerPayments).values({
    customerId: ahmad.id, jobId: ahmadJob.id, amount: "3000.00", paymentDate: dateOnly(daysAgo(9)),
    method: "cash", receivedByUserId: mohammad.id, approvalStatus: "approved",
    createdByUserId: mohammad.id, approvedByUserId: mohammad.id, approvedAt: daysAgo(9), createdAt: daysAgo(9),
    notes: "Deposit on signing.",
  }).returning();
  const [midPayment] = await db.insert(schema.customerPayments).values({
    customerId: ahmad.id, jobId: ahmadJob.id, amount: "5000.00", paymentDate: dateOnly(daysAgo(5)),
    method: "cash", receivedByUserId: issam.id, approvalStatus: "approved",
    createdByUserId: issam.id, approvedByUserId: mohammad.id, approvedAt: daysAgo(5), createdAt: daysAgo(5),
    notes: "Collected on installation day.",
  }).returning();
  await db.insert(schema.customerPayments).values({
    customerId: ahmad.id, jobId: ahmadJob.id, amount: "4000.00", paymentDate: dateOnly(daysAgo(1)),
    method: "bank_transfer", receivedByUserId: mohammad.id, approvalStatus: "approved",
    createdByUserId: mohammad.id, approvedByUserId: mohammad.id, approvedAt: daysAgo(1), createdAt: daysAgo(1),
    notes: "Final balance on completion.",
  });

  await db.insert(schema.cashTransactions).values([
    { cashAccountId: mohammadCash.id, direction: "in", amount: "3000.00", sourceType: "customer_payment", sourceId: depositPayment.id, createdByUserId: mohammad.id, createdAt: daysAgo(9) },
    { cashAccountId: issamCash.id, direction: "in", amount: "5000.00", sourceType: "customer_payment", sourceId: midPayment.id, createdByUserId: issam.id, createdAt: daysAgo(5) },
  ]);
  const [ahmadTransfer] = await db.insert(schema.cashTransfers).values({
    fromCashAccountId: issamCash.id, toCashAccountId: companyCash.id, amount: "5000.00",
    transferredAt: daysAgo(4), createdByUserId: issam.id, confirmedByUserId: amr.id, confirmedAt: daysAgo(4),
    notes: "Handed over after Ahmad job.",
  }).returning();
  await db.insert(schema.cashTransactions).values([
    { cashAccountId: issamCash.id, direction: "out", amount: "5000.00", sourceType: "transfer", sourceId: ahmadTransfer.id, createdByUserId: amr.id, createdAt: daysAgo(4) },
    { cashAccountId: companyCash.id, direction: "in", amount: "5000.00", sourceType: "transfer", sourceId: ahmadTransfer.id, createdByUserId: amr.id, createdAt: daysAgo(4) },
  ]);

  await db.insert(schema.repairs).values({
    jobId: ahmadJob.id,
    problemDescription: "Small chip near a railing bracket noticed after installation.",
    dateReported: dateOnly(daysAgo(3)),
    responsibleUserId: issam.id,
    scheduledDate: dateOnly(daysAgo(2)),
    status: "resolved",
    resolvedAt: daysAgo(1),
    createdByUserId: mohammad.id,
    notes: "Bracket replaced free of charge; customer confirmed satisfied.",
  });

  // ---------------------------------------------------------------------
  // Job 2: سارة حداد — Waiting for Pricing (tests that dashboard widget)
  // ---------------------------------------------------------------------
  console.log("Seeding Job 2: Sara (waiting for pricing)...");
  const [sara] = await db.insert(schema.customers).values({
    name: "سارة حداد", phone: "+972505552002", address: "شارع الجليل 8، عكا", createdByUserId: basel.id,
  }).returning();
  const [saraJob] = await db.insert(schema.jobs).values({
    jobNumber: "JOB-2026-0002", customerId: sara.id, statusId: statusByKey.waiting_for_pricing.id,
    title: "Kitchen glass splashback", measuredByUserId: basel.id, pricingResponsibleUserId: mohammad.id,
    createdByUserId: basel.id, createdAt: daysAgo(1),
  }).returning();
  await db.insert(schema.measurements).values({
    jobId: saraJob.id, measuredByUserId: basel.id, measuredAt: daysAgo(1),
    details: "Kitchen glass splashback, 3.2 linear meters, standard height.",
    photosTaken: true, pricingResponsibleUserId: mohammad.id,
  });
  await db.insert(schema.appointments).values({
    jobId: saraJob.id, type: "measurement", scheduledStart: daysAgo(1), status: "completed",
    location: sara.address, createdByUserId: basel.id,
  });

  // ---------------------------------------------------------------------
  // Job 3: خالد منصور — Quote sent, awaiting customer signature. A real
  // public signing link is seeded so the flow can be tested end to end.
  // ---------------------------------------------------------------------
  console.log("Seeding Job 3: Khaled (quote awaiting signature)...");
  const [khaled] = await db.insert(schema.customers).values({
    name: "خالد منصور", phone: "+972505553003", address: "شارع البحر 22، حيفا", createdByUserId: issam.id,
  }).returning();
  const [khaledJob] = await db.insert(schema.jobs).values({
    jobNumber: "JOB-2026-0003", customerId: khaled.id, statusId: statusByKey.waiting_for_customer_approval.id,
    title: "Door + fixed glass", measuredByUserId: issam.id, pricingResponsibleUserId: mohammad.id,
    createdByUserId: issam.id, createdAt: daysAgo(3),
  }).returning();
  const [khaledQuote] = await db.insert(schema.quotes).values({
    quoteNumber: "Q-2026-0002", customerId: khaled.id, jobId: khaledJob.id, status: "sent",
    createdByUserId: mohammad.id, createdAt: daysAgo(2),
  }).returning();
  const [khaledQuoteV1] = await db.insert(schema.quoteVersions).values({
    quoteId: khaledQuote.id, versionNumber: 1,
    paymentTerms: SETTINGS_DEFAULTS.quote_default_terms.paymentTerms,
    workTerms: SETTINGS_DEFAULTS.quote_default_terms.workTerms,
    validUntil: dateOnly(daysFromNow(12)), subtotal: "3800.00", total: "3800.00",
    isSigned: false, createdByUserId: mohammad.id, createdAt: daysAgo(2),
  }).returning();
  await db.insert(schema.quoteItems).values([
    { quoteVersionId: khaledQuoteV1.id, workTypeId: workTypeByKey.door.id, description: "Aluminum-framed glass door, existing jack", quantity: "1", unit: "unit", unitPrice: "2200.00", lineTotal: "2200.00", sortOrder: 0 },
    { quoteVersionId: khaledQuoteV1.id, workTypeId: workTypeByKey.fixed_glass.id, description: "Fixed glass side panel", quantity: "2", unit: "meter", unitPrice: "800.00", lineTotal: "1600.00", sortOrder: 1 },
  ]);
  await db.update(schema.quotes).set({ currentVersionId: khaledQuoteV1.id }).where(sql`${schema.quotes.id} = ${khaledQuote.id}`);
  const khaledToken = generateSecureToken();
  await db.insert(schema.quotePublicLinks).values({
    quoteId: khaledQuote.id, token: khaledToken, expiresAt: daysFromNow(12), createdByUserId: mohammad.id,
  });
  console.log(`  -> Khaled's public signing link token: ${khaledToken}`);

  // ---------------------------------------------------------------------
  // Job 4: ريم صالح — Ready from factory, no installation date yet.
  // ---------------------------------------------------------------------
  console.log("Seeding Job 4: Reem (ready from factory)...");
  const [reem] = await db.insert(schema.customers).values({
    name: "ريم صالح", phone: "+972505554004", address: "شارع الأمل 3، الناصرة", createdByUserId: mohammad.id,
  }).returning();
  const [reemJob] = await db.insert(schema.jobs).values({
    jobNumber: "JOB-2026-0004", customerId: reem.id, statusId: statusByKey.ready_from_factory.id,
    title: "Storefront glass", measuredByUserId: issam.id, pricingResponsibleUserId: mohammad.id,
    dealClosedByUserId: mohammad.id, salePriceTotal: "6500.00", createdByUserId: mohammad.id, createdAt: daysAgo(15),
  }).returning();
  const [reemQuote] = await db.insert(schema.quotes).values({
    quoteNumber: "Q-2026-0003", customerId: reem.id, jobId: reemJob.id, status: "signed",
    createdByUserId: mohammad.id, createdAt: daysAgo(14),
  }).returning();
  const [reemQuoteV1] = await db.insert(schema.quoteVersions).values({
    quoteId: reemQuote.id, versionNumber: 1,
    paymentTerms: SETTINGS_DEFAULTS.quote_default_terms.paymentTerms,
    workTerms: SETTINGS_DEFAULTS.quote_default_terms.workTerms,
    validUntil: dateOnly(daysAgo(0)), subtotal: "6500.00", total: "6500.00",
    isSigned: true, createdByUserId: mohammad.id, createdAt: daysAgo(14),
  }).returning();
  await db.insert(schema.quoteItems).values({
    quoteVersionId: reemQuoteV1.id, workTypeId: workTypeByKey.storefront.id, description: "Shop storefront glass panels", quantity: "1", unit: "job", unitPrice: "6500.00", lineTotal: "6500.00", sortOrder: 0,
  });
  await db.insert(schema.quoteSignatures).values({
    quoteVersionId: reemQuoteV1.id, signedAt: daysAgo(13), customerNameAtSigning: "ريم صالح",
    customerPhoneAtSigning: reem.phone, customerAddressAtSigning: reem.address,
    agreedToTerms: true, signatureImage: TINY_PNG,
  });
  await db.update(schema.quotes).set({ currentVersionId: reemQuoteV1.id, signedVersionId: reemQuoteV1.id }).where(sql`${schema.quotes.id} = ${reemQuote.id}`);
  await db.update(schema.jobs).set({ quoteId: reemQuote.id, sourceQuoteVersionId: reemQuoteV1.id }).where(sql`${schema.jobs.id} = ${reemJob.id}`);
  await db.insert(schema.jobItems).values({
    jobId: reemJob.id, workTypeId: workTypeByKey.storefront.id, description: "Shop storefront glass panels", quantity: "1", unit: "job", salePrice: "6500.00", status: "ready",
  });
  const [reemProdRequest] = await db.insert(schema.productionRequests).values({
    jobId: reemJob.id, requestedByUserId: mohammad.id, details: "Storefront tempered glass panels, 3 sections.",
    status: "approved", estimatedReadyDate: dateOnly(daysAgo(1)), createdAt: daysAgo(12),
  }).returning();
  await db.insert(schema.factorySubmissions).values({
    productionRequestId: reemProdRequest.id, submittedPrice: "2100.00", submittedAt: daysAgo(11),
    approvalStatus: "approved", approvedByUserId: mohammad.id, approvedAt: daysAgo(11),
  });
  await db.insert(schema.jobCosts).values({
    jobId: reemJob.id, category: "factory_glass", amount: "2100.00", status: "approved",
    createdByUserId: mohammad.id, approvedByUserId: mohammad.id, approvedAt: daysAgo(11), incurredAt: dateOnly(daysAgo(11)),
  });
  const [reemDeposit] = await db.insert(schema.customerPayments).values({
    customerId: reem.id, jobId: reemJob.id, amount: "2000.00", paymentDate: dateOnly(daysAgo(14)),
    method: "cash", receivedByUserId: mohammad.id, approvalStatus: "approved",
    createdByUserId: mohammad.id, approvedByUserId: mohammad.id, approvedAt: daysAgo(14), createdAt: daysAgo(14),
  }).returning();
  await db.insert(schema.cashTransactions).values({
    cashAccountId: mohammadCash.id, direction: "in", amount: "2000.00", sourceType: "customer_payment", sourceId: reemDeposit.id, createdByUserId: mohammad.id, createdAt: daysAgo(14),
  });

  // ---------------------------------------------------------------------
  // Job 5: نبيل عودة — Installed but with an open repair, a partial
  // balance, and a check due soon (tests three Needs Attention widgets).
  // ---------------------------------------------------------------------
  console.log("Seeding Job 5: Nabil (open repair + balance + check due soon)...");
  const [nabil] = await db.insert(schema.customers).values({
    name: "نبيل عودة", phone: "+972505555005", address: "شارع الكرمل 30، حيفا", createdByUserId: issam.id,
  }).returning();
  const [nabilJob] = await db.insert(schema.jobs).values({
    jobNumber: "JOB-2026-0005", customerId: nabil.id, statusId: statusByKey.repair_needed.id,
    title: "Mirror + aluminum door", measuredByUserId: issam.id, pricingResponsibleUserId: mohammad.id,
    dealClosedByUserId: issam.id, salePriceTotal: "9000.00", createdByUserId: issam.id, createdAt: daysAgo(20),
  }).returning();
  const [nabilQuote] = await db.insert(schema.quotes).values({
    quoteNumber: "Q-2026-0004", customerId: nabil.id, jobId: nabilJob.id, status: "signed",
    createdByUserId: mohammad.id, createdAt: daysAgo(19),
  }).returning();
  const [nabilQuoteV1] = await db.insert(schema.quoteVersions).values({
    quoteId: nabilQuote.id, versionNumber: 1,
    paymentTerms: SETTINGS_DEFAULTS.quote_default_terms.paymentTerms,
    workTerms: SETTINGS_DEFAULTS.quote_default_terms.workTerms,
    validUntil: dateOnly(daysAgo(5)), subtotal: "9000.00", total: "9000.00",
    isSigned: true, createdByUserId: mohammad.id, createdAt: daysAgo(19),
  }).returning();
  await db.insert(schema.quoteItems).values([
    { quoteVersionId: nabilQuoteV1.id, workTypeId: workTypeByKey.mirror.id, description: "Hallway mirror", quantity: "6", unit: "meter", unitPrice: "400.00", lineTotal: "2400.00", sortOrder: 0 },
    { quoteVersionId: nabilQuoteV1.id, workTypeId: workTypeByKey.aluminum.id, description: "Aluminum entrance door", quantity: "1", unit: "unit", unitPrice: "6600.00", lineTotal: "6600.00", sortOrder: 1 },
  ]);
  await db.insert(schema.quoteSignatures).values({
    quoteVersionId: nabilQuoteV1.id, signedAt: daysAgo(18), customerNameAtSigning: "نبيل عودة",
    customerPhoneAtSigning: nabil.phone, customerAddressAtSigning: nabil.address,
    agreedToTerms: true, signatureImage: TINY_PNG,
  });
  await db.update(schema.quotes).set({ currentVersionId: nabilQuoteV1.id, signedVersionId: nabilQuoteV1.id }).where(sql`${schema.quotes.id} = ${nabilQuote.id}`);
  await db.update(schema.jobs).set({ quoteId: nabilQuote.id, sourceQuoteVersionId: nabilQuoteV1.id }).where(sql`${schema.jobs.id} = ${nabilJob.id}`);
  await db.insert(schema.jobItems).values([
    { jobId: nabilJob.id, workTypeId: workTypeByKey.mirror.id, description: "Hallway mirror", quantity: "6", unit: "meter", salePrice: "2400.00", status: "installed" },
    { jobId: nabilJob.id, workTypeId: workTypeByKey.aluminum.id, description: "Aluminum entrance door", quantity: "1", unit: "unit", salePrice: "6600.00", status: "installed" },
  ]);
  await db.insert(schema.jobAssignments).values({ jobId: nabilJob.id, userId: basel.id, role: "installer", createdByUserId: issam.id });
  const [nabilPayment] = await db.insert(schema.customerPayments).values({
    customerId: nabil.id, jobId: nabilJob.id, amount: "5000.00", paymentDate: dateOnly(daysAgo(6)),
    method: "cash", receivedByUserId: basel.id, approvalStatus: "approved",
    createdByUserId: basel.id, approvedByUserId: mohammad.id, approvedAt: daysAgo(6), createdAt: daysAgo(6),
  }).returning();
  await db.insert(schema.cashTransactions).values({
    cashAccountId: baselCash.id, direction: "in", amount: "5000.00", sourceType: "customer_payment", sourceId: nabilPayment.id, createdByUserId: basel.id, createdAt: daysAgo(6),
  });
  await db.insert(schema.repairs).values({
    jobId: nabilJob.id,
    problemDescription: "Door does not close smoothly, hinge needs adjustment.",
    dateReported: dateOnly(daysAgo(2)),
    responsibleUserId: basel.id,
    scheduledDate: dateOnly(daysFromNow(1)),
    status: "scheduled",
    createdByUserId: issam.id,
  });
  await db.insert(schema.incomingChecks).values({
    customerId: nabil.id, jobId: nabilJob.id, amount: "2000.00", checkNumber: "00458219",
    bank: "בנק לאומי / Bank Leumi", dueDate: dateOnly(daysFromNow(2)), receivedByUserId: mohammad.id,
    status: "future", notes: "Second installment, post-dated at signing.",
  });

  console.log("Seeding external contractor + outgoing check (for screen coverage)...");
  await db.insert(schema.externalContractors).values({
    name: "أبو علي للألمنيوم / Abu Ali Aluminum", phone: "+972506661234", serviceType: "Aluminum installation",
  });
  await db.insert(schema.outgoingChecks).values({
    payeeName: "Glass Supply Co.", amount: "4500.00", checkNumber: "77123", dueDate: dateOnly(daysFromNow(10)),
    reason: "Raw glass stock replenishment", status: "pending", createdByUserId: amr.id,
  });

  console.log("Seeding a pending approval request (worker-reported payment)...");
  const [pendingReport] = await db.insert(schema.customerPayments).values({
    customerId: nabil.id, jobId: nabilJob.id, amount: "1000.00", paymentDate: dateOnly(daysAgo(0)),
    method: "cash", receivedByUserId: issam.id, approvalStatus: "pending",
    createdByUserId: issam.id, createdAt: daysAgo(0),
    notes: "Reported by Issam, awaiting management approval.",
  }).returning();
  await db.insert(schema.approvalRequests).values({
    entityType: "customer_payment", entityId: pendingReport.id, requestedByUserId: issam.id,
    summary: "Issam reported a customer payment received: 1,000 ₪ (Nabil Odeh)",
    relatedJobId: nabilJob.id,
  });

  console.log("Seeding number sequences (continuing on from the demo jobs/quotes above, which use hardcoded numbers rather than nextDocumentNumber())...");
  await db.insert(schema.numberSequences).values([
    { scope: "job", year: 2026, lastValue: 5 }, // JOB-2026-0001..0005 used above
    { scope: "quote", year: 2026, lastValue: 4 }, // Q-2026-0001..0004 used above
  ]);

  console.log("Done.");
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
