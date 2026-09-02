// Manual verification script for Phase 10b (Dashboard "Needs Attention"
// consolidation, spec section 59 + the Reports screens, spec section 68,
// with CSV export) — not part of the automated test suite. Drives a real
// headless browser against the seeded demo data, plus direct DB reads via
// the pg Pool for the underlying-row checks, same convention as
// verify-phase7/8/9/10a.mjs.
//
// UNLIKE verify-phase7/8/9/10a.mjs (which chain off each other's live
// mutations when run in that order), this script only reads pre-existing
// seed state and creates no new UI-driven mutations of its own — every
// check here holds on a freshly reseeded DB (`npm run db:seed`) run in
// isolation. It should still pass if run after the other four in sequence,
// but a fresh reseed first is the tested/expected way to run it.
//
// Calls chromium.launch() with no executablePath override (this machine's
// locally-installed Playwright browser), same as verify-phase7/8/9/10a.mjs.
import "dotenv/config";
import { chromium } from "playwright-core";
import { Pool } from "pg";

const BASE_URL = "http://localhost:3000";

const LABEL = {
  readyNoInstall: "مهام جاهزة من المصنع بدون موعد تركيب",
  openRepairs: "إصلاحات مفتوحة",
  waitingForPricing: "بانتظار التسعير",
  waitingForSignature: "بانتظار توقيع عرض السعر",
  factoryWaitingApproval: "أسعار مصنع بانتظار الاعتماد",
  customersBalance: "أرصدة عملاء مستحقة",
  checksDueSoon: "شيكات مستحقة قريباً",
  pendingApprovals: "طلبات بانتظار الموافقة",
};

let failures = 0;
function check(label, ok) {
  console.log(`   ${ok ? "OK" : "FAIL"}: ${label}`);
  if (!ok) failures++;
}

async function login(page, phone, password) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle" });
  await page.fill("#phone", phone);
  await page.fill("#password", password);
  await Promise.all([
    page.waitForURL("**/dashboard", { timeout: 10000 }),
    page.click('button[type="submit"]'),
  ]);
}

async function dashboardText(page) {
  await page.goto(`${BASE_URL}/dashboard`, { waitUntil: "networkidle" });
  return page.innerText("body");
}

/**
 * Reads one "تحتاج انتباه" row by its label text, scoped to that row's OWN
 * innerText — deliberately never the whole page body. This matters here:
 * "جدول اليوم" (today's schedule, rendered just above the Needs Attention
 * card) independently shows some of the very same job numbers/customer
 * names (Reem's and Sara's jobs both have a real appointment scheduled for
 * today, with real assignees), so a whole-page text.includes() check could
 * pass for the wrong reason — or, worse, a NOT-includes() absence check
 * could fail even though the Needs Attention row itself is correctly
 * scoped. Reading the row's own text is what actually proves the item
 * itself is right, not just that the job number appears SOMEWHERE.
 */
async function attentionRow(page, label) {
  const locator = page.locator("li", { hasText: label }).first();
  const present = (await locator.count()) > 0;
  return { present, text: present ? await locator.innerText() : "", locator };
}

async function attentionBadgeCount(page, label) {
  const row = await attentionRow(page, label);
  if (!row.present) return null;
  const badgeText = (await row.locator.locator('[data-slot="badge"]').first().innerText()).trim();
  return Number(badgeText);
}

async function main() {
  const browser = await chromium.launch();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const ctx = await browser.newContext({ locale: "ar" });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  try {
    console.log("=== Setup: locate seeded jobs ===");
    await login(page, "0501111111", "password123"); // Amr, super-admin

    const { rows: idRows } = await pool.query(
      `select id, job_number from jobs where job_number in
       ('JOB-2026-0002','JOB-2026-0003','JOB-2026-0004','JOB-2026-0005','JOB-2026-0006','JOB-2026-0008')`,
    );
    const jobIdByNumber = Object.fromEntries(idRows.map((r) => [r.job_number, r.id]));
    const yasminJobId = jobIdByNumber["JOB-2026-0008"];

    // -----------------------------------------------------------------
    // Part A: fresh-seed sanity for Job 8 (Yasmin) — the seed addition
    // this phase made so "factory price waiting approval" isn't empty on
    // a fresh seed (none of jobs 1/4/6's production_requests ever sit at
    // status='submitted' — all three go straight to 'approved').
    // -----------------------------------------------------------------
    console.log("\n--- Part A: seed data actually exercises the factory-price-waiting-approval category (DB) ---");
    const { rows: prRows } = await pool.query(
      `select status from production_requests where job_id = $1`,
      [yasminJobId],
    );
    check("Yasmin's job has exactly one production_request, status='submitted' (DB)", prRows.length === 1 && prRows[0].status === "submitted");
    const { rows: subRows } = await pool.query(
      `select fs.approval_status from factory_submissions fs
       join production_requests pr on pr.id = fs.production_request_id
       where pr.job_id = $1`,
      [yasminJobId],
    );
    check("Yasmin's production_request has a pending factory_submission (DB)", subRows.length === 1 && subRows[0].approval_status === "pending");
    const { rows: apprRows } = await pool.query(
      `select status from approval_requests where entity_type = 'factory_submission' and related_job_id = $1`,
      [yasminJobId],
    );
    check("Yasmin's factory_submission has a matching pending approval_requests row (DB)", apprRows.length === 1 && apprRows[0].status === "pending");

    // -----------------------------------------------------------------
    // Part B: Dashboard "تحتاج انتباه" — full (unscoped) view for Amr, a
    // VIEW_ALL_JOBS holder with every permission. All 8 categories carry
    // real, correct, non-empty seeded data.
    // -----------------------------------------------------------------
    console.log("\n--- Part B: dashboard Needs Attention — full visibility (Amr) ---");
    let text = await dashboardText(page);
    check("'تحتاج انتباه' section is present at all", text.includes("تحتاج انتباه"));

    let row = await attentionRow(page, LABEL.readyNoInstall);
    check("ready-without-install row present, shows Mona's job", row.present && row.text.includes("JOB-2026-0006"));

    row = await attentionRow(page, LABEL.openRepairs);
    check("open-repairs row present, shows Reem's AND Nabil's jobs", row.present && row.text.includes("JOB-2026-0004") && row.text.includes("JOB-2026-0005"));

    row = await attentionRow(page, LABEL.waitingForPricing);
    check("waiting-for-pricing row present, shows Sara's job", row.present && row.text.includes("JOB-2026-0002"));

    row = await attentionRow(page, LABEL.waitingForSignature);
    check("waiting-for-quote-signature row present, shows Khaled's job", row.present && row.text.includes("JOB-2026-0003"));

    row = await attentionRow(page, LABEL.factoryWaitingApproval);
    check("factory-price-waiting-approval row present, shows Yasmin's job", row.present && row.text.includes("JOB-2026-0008"));

    row = await attentionRow(page, LABEL.customersBalance);
    check(
      "customers-with-balance row present, shows all 4 customers with a positive balance and excludes the 2 fully-paid ones",
      row.present &&
        row.text.includes("ريم صالح") &&
        row.text.includes("نبيل عودة") &&
        row.text.includes("منى خليل") &&
        row.text.includes("ياسمين نمر") &&
        !row.text.includes("أحمد يوسف") &&
        !row.text.includes("كريم شاهين"),
    );

    row = await attentionRow(page, LABEL.checksDueSoon);
    check("checks-due-soon row present, shows Nabil's check", row.present && row.text.includes("نبيل عودة"));

    check("pending-approvals row present", (await attentionRow(page, LABEL.pendingApprovals)).present);

    const { rows: pendingRows } = await pool.query(`select count(*)::int as c from approval_requests where status = 'pending'`);
    const totalPending = pendingRows[0].c;
    const { rows: thresholdRows } = await pool.query(
      `select value from application_settings where key = 'notification_thresholds'`,
    );
    const checkDueSoonDays = thresholdRows[0].value.checkDueSoonDays;
    const { rows: dueSoonRows } = await pool.query(
      `select count(*)::int as c from incoming_checks where status in ('future','due_soon') and due_date <= current_date + $1::int`,
      [checkDueSoonDays],
    );
    const totalDueSoon = dueSoonRows[0].c;
    check(`pending-approvals badge shows the true unrestricted total (${totalPending}) for Amr (DB cross-check)`, (await attentionBadgeCount(page, LABEL.pendingApprovals)) === totalPending);
    check(`checks-due-soon badge shows the true total (${totalDueSoon}) for Amr (DB cross-check)`, (await attentionBadgeCount(page, LABEL.checksDueSoon)) === totalDueSoon);

    // -----------------------------------------------------------------
    // Part C: Dashboard scoping — Issam (VIEW_ASSIGNED_JOBS only). Reuses
    // Phase 9's own involvementFilter-scoping pattern: a restricted
    // viewer must never see a job/customer they aren't measured-by/
    // priced-by/deal-closed-by/assigned-to, checked here for every NEW
    // Phase 10b category exactly like the pre-existing ones. Issam is
    // seeded as measuredByUserId on Khaled/Reem/Yasmin and dealClosedBy
    // on Nabil too, but has no connection at all to Sara's or Mona's job.
    // -----------------------------------------------------------------
    console.log("\n--- Part C: dashboard Needs Attention scoping — Issam (involved in Khaled+Reem+Nabil+Yasmin, NOT Sara/Mona) ---");
    await ctx.clearCookies();
    await login(page, "0503333333", "password123"); // Issam
    text = await dashboardText(page);
    check("Issam: waiting-for-pricing row ABSENT (not involved in Sara's job)", !(await attentionRow(page, LABEL.waitingForPricing)).present);
    check("Issam: ready-without-install row ABSENT (not involved in Mona's job)", !(await attentionRow(page, LABEL.readyNoInstall)).present);

    row = await attentionRow(page, LABEL.waitingForSignature);
    check("Issam: waiting-for-quote-signature row PRESENT, shows Khaled's job (he measured it)", row.present && row.text.includes("JOB-2026-0003"));

    row = await attentionRow(page, LABEL.factoryWaitingApproval);
    check("Issam: factory-price-waiting-approval row PRESENT, shows Yasmin's job (he measured it)", row.present && row.text.includes("JOB-2026-0008"));

    row = await attentionRow(page, LABEL.openRepairs);
    check("Issam: open-repairs row shows BOTH Reem's and Nabil's jobs (measured/deal-closed both)", row.present && row.text.includes("JOB-2026-0004") && row.text.includes("JOB-2026-0005"));

    row = await attentionRow(page, LABEL.customersBalance);
    check(
      "Issam: customers-with-balance row shows Reem/Nabil/Yasmin but NOT Mona (not involved in any of Mona's jobs)",
      row.present && row.text.includes("ريم صالح") && row.text.includes("نبيل عودة") && row.text.includes("ياسمين نمر") && !row.text.includes("منى خليل"),
    );

    check("Issam: checks-due-soon row ABSENT entirely — lacks MANAGE_CHECKS (a permission gate, not just empty data)", !(await attentionRow(page, LABEL.checksDueSoon)).present);
    check("Issam: pending-approvals row ABSENT entirely — lacks APPROVE_REQUESTS", !(await attentionRow(page, LABEL.pendingApprovals)).present);

    // -----------------------------------------------------------------
    // Part D: Dashboard scoping — Basel (VIEW_ASSIGNED_JOBS only), the
    // complementary case: involved in Sara+Mona (measured) and Nabil
    // (installer assignment), NOT Khaled/Reem/Yasmin — a real two-way
    // diff against Issam's own view above. Reem's job in particular is
    // the sharpest test here: Basel IS a today's-appointment assignee on
    // Reem's installation (so Reem's job number legitimately appears in
    // Basel's "جدول اليوم" schedule higher up the SAME page) while still
    // correctly NOT involved in Reem's job for Needs Attention purposes
    // — attentionRow()'s row-scoping is what makes this a real test
    // instead of a false pass/fail from that unrelated schedule section.
    // -----------------------------------------------------------------
    console.log("\n--- Part D: dashboard Needs Attention scoping — Basel (involved in Sara+Mona+Nabil, NOT Khaled/Reem/Yasmin) ---");
    await ctx.clearCookies();
    await login(page, "0504444444", "password123"); // Basel
    text = await dashboardText(page);

    row = await attentionRow(page, LABEL.waitingForPricing);
    check("Basel: waiting-for-pricing row PRESENT, shows Sara's job (he measured it)", row.present && row.text.includes("JOB-2026-0002"));

    row = await attentionRow(page, LABEL.readyNoInstall);
    check("Basel: ready-without-install row PRESENT, shows Mona's job (he measured it)", row.present && row.text.includes("JOB-2026-0006"));

    check("Basel: waiting-for-quote-signature row ABSENT (not involved in Khaled's job)", !(await attentionRow(page, LABEL.waitingForSignature)).present);
    check("Basel: factory-price-waiting-approval row ABSENT (not involved in Yasmin's job)", !(await attentionRow(page, LABEL.factoryWaitingApproval)).present);

    row = await attentionRow(page, LABEL.openRepairs);
    check(
      "Basel: open-repairs row shows Nabil's job (installer) but NOT Reem's (not involved, despite Reem's job appearing in today's schedule elsewhere on this same page)",
      row.present && row.text.includes("JOB-2026-0005") && !row.text.includes("JOB-2026-0004"),
    );

    row = await attentionRow(page, LABEL.customersBalance);
    check(
      "Basel: customers-with-balance row shows Mona/Nabil but NOT Reem or Yasmin (same schedule-collision trap as above)",
      row.present && row.text.includes("منى خليل") && row.text.includes("نبيل عودة") && !row.text.includes("ريم صالح") && !row.text.includes("ياسمين نمر"),
    );

    check("Basel: checks-due-soon row ABSENT entirely — lacks MANAGE_CHECKS", !(await attentionRow(page, LABEL.checksDueSoon)).present);
    check("Basel: pending-approvals row ABSENT entirely — lacks APPROVE_REQUESTS", !(await attentionRow(page, LABEL.pendingApprovals)).present);

    // -----------------------------------------------------------------
    // Part E: financial-permission-gated categories genuinely SHOW (with
    // correct data) for a non-super-admin who legitimately holds the
    // gating permission — Mohammad (VIEW_ALL_JOBS + MANAGE_CHECKS +
    // APPROVE_REQUESTS, but NOT MANAGE_VEHICLES/ADD_FUEL).
    // -----------------------------------------------------------------
    console.log("\n--- Part E: financial-permission-gated categories show for Mohammad (holds MANAGE_CHECKS + APPROVE_REQUESTS) ---");
    await ctx.clearCookies();
    await login(page, "0502222222", "password123"); // Mohammad
    text = await dashboardText(page);
    check("Mohammad: checks-due-soon row present", (await attentionRow(page, LABEL.checksDueSoon)).present);
    check("Mohammad: pending-approvals row present", (await attentionRow(page, LABEL.pendingApprovals)).present);
    check(`Mohammad (VIEW_ALL_JOBS, unrestricted): pending-approvals badge shows the true total (${totalPending})`, (await attentionBadgeCount(page, LABEL.pendingApprovals)) === totalPending);

    // -----------------------------------------------------------------
    // Part F: Reports (spec section 68) — permission matrix. Each of the
    // 5 reports has its OWN gating permission (not a single umbrella
    // "view reports" key), checked both via the /reports tab nav (a tab
    // for a report the viewer can't access must be genuinely absent, not
    // merely unclicked) and via a direct hit on the CSV export route.
    // -----------------------------------------------------------------
    console.log("\n--- Part F: Reports permission matrix (nav tabs + direct API access) ---");
    const REPORT_MATRIX = {
      "0502222222": { name: "Mohammad", jobs: true, customers: true, technicians: true, vehicles: false, profitability: true },
      "0503333333": { name: "Issam", jobs: false, customers: false, technicians: false, vehicles: true, profitability: false },
      "0504444444": { name: "Basel", jobs: false, customers: false, technicians: false, vehicles: true, profitability: false },
    };
    for (const [phone, expected] of Object.entries(REPORT_MATRIX)) {
      await ctx.clearCookies();
      await login(page, phone, "password123");
      await page.goto(`${BASE_URL}/reports`, { waitUntil: "networkidle" });
      for (const key of ["jobs", "customers", "technicians", "vehicles", "profitability"]) {
        const tabPresent = (await page.locator(`a[href="/reports?tab=${key}"]`).count()) > 0;
        check(`${expected.name}: /reports nav tab '${key}' ${expected[key] ? "PRESENT" : "ABSENT"} as expected`, tabPresent === expected[key]);
        const apiRes = await page.request.get(`${BASE_URL}/api/reports/${key}`);
        check(`${expected.name}: GET /api/reports/${key} -> ${expected[key] ? "200" : "403"} as expected`, expected[key] ? apiRes.status() === 200 : apiRes.status() === 403);
      }
    }

    // -----------------------------------------------------------------
    // Part G: a disallowed ?tab= falls back to the viewer's own first
    // permitted tab instead of leaking the requested report's data.
    // -----------------------------------------------------------------
    console.log("\n--- Part G: disallowed ?tab= falls back safely, never leaks the requested report ---");
    await ctx.clearCookies();
    await login(page, "0503333333", "password123"); // Issam: only 'vehicles' permitted
    await page.goto(`${BASE_URL}/reports?tab=profitability`, { waitUntil: "networkidle" });
    text = await page.innerText("body");
    check("Issam requesting ?tab=profitability actually renders the vehicles report instead (fallback)", text.includes("الليترات") || text.includes("رقم اللوحة"));
    check("Issam requesting ?tab=profitability never renders profitability's own column header", !text.includes("هامش الربح"));

    // -----------------------------------------------------------------
    // Part H: profitability specifically hidden from a non-VIEW_PROFITABILITY
    // viewer (Basel) — this project's standing financial-visibility rule,
    // checked at every layer: nav, page fallback, JSON API, and the CSV
    // export route itself (the same endpoint the "تصدير CSV" link points
    // at, so this is really the same gate checked a second, more direct
    // way).
    // -----------------------------------------------------------------
    console.log("\n--- Part H: profitability financial-visibility — hidden end to end for Basel ---");
    await ctx.clearCookies();
    await login(page, "0504444444", "password123"); // Basel: lacks VIEW_PROFITABILITY
    await page.goto(`${BASE_URL}/reports`, { waitUntil: "networkidle" });
    check("Basel: no /reports?tab=profitability link anywhere in the nav", (await page.locator('a[href="/reports?tab=profitability"]').count()) === 0);
    check("Basel: profitability's own column header never rendered on /reports at all", !(await page.innerText("body")).includes("هامش الربح"));
    const baselProfitApi = await page.request.get(`${BASE_URL}/api/reports/profitability`);
    check("Basel: GET /api/reports/profitability -> 403 (JSON error, not data)", baselProfitApi.status() === 403);
    const baselProfitCsv = await page.request.get(`${BASE_URL}/api/reports/profitability?dateFrom=2020-01-01`);
    check("Basel: profitability CSV export route ALSO -> 403 (same gate, checked directly)", baselProfitCsv.status() === 403);

    // -----------------------------------------------------------------
    // Part I: CSV export — a real, correctly-formatted RFC 4180 file for
    // every report: 200 + text/csv + attachment Content-Disposition + a
    // genuine UTF-8 BOM as the first 3 bytes + an exact Arabic header row
    // + real seeded data in the body (as Amr, who can access all five).
    // -----------------------------------------------------------------
    console.log("\n--- Part I: CSV export format + content, all 5 reports (Amr) ---");
    await ctx.clearCookies();
    await login(page, "0501111111", "password123"); // Amr

    async function checkCsv({ key, filename, header, mustInclude = [], mustNotInclude = [] }) {
      const res = await page.request.get(`${BASE_URL}/api/reports/${key}`);
      check(`${key} CSV: 200 OK`, res.status() === 200);
      check(`${key} CSV: Content-Type is text/csv; charset=utf-8`, (res.headers()["content-type"] || "") === "text/csv; charset=utf-8");
      check(
        `${key} CSV: Content-Disposition is attachment; filename="${filename}"`,
        (res.headers()["content-disposition"] || "") === `attachment; filename="${filename}"`,
      );
      const buf = await res.body();
      check(`${key} CSV: body starts with a genuine UTF-8 BOM (EF BB BF)`, buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf);
      const bodyText = buf.toString("utf8");
      const lines = bodyText.replace(/^﻿/, "").split("\r\n").filter((l) => l.length > 0);
      check(`${key} CSV: header row matches exactly`, lines[0] === header);
      check(`${key} CSV: has at least one real data row`, lines.length > 1);
      for (const s of mustInclude) check(`${key} CSV: body includes "${s}"`, bodyText.includes(s));
      for (const s of mustNotInclude) check(`${key} CSV: body correctly excludes "${s}"`, !bodyText.includes(s));
    }

    await checkCsv({
      key: "jobs",
      filename: "jobs-report.csv",
      header: "رقم المهمة,العميل,الحالة,تاريخ الإنشاء,سعر البيع",
      mustInclude: ["JOB-2026-0008", "ياسمين نمر"],
    });
    await checkCsv({
      key: "customers",
      filename: "customers-outstanding-report.csv",
      header: "العميل,الهاتف,الرصيد المستحق,آخر مهمة,تاريخ آخر مهمة",
      mustInclude: ["ياسمين نمر", "نبيل عودة", "منى خليل", "ريم صالح"],
      mustNotInclude: ["كريم شاهين", "أحمد يوسف"], // both fully paid — zero balance, correctly excluded
    });
    await checkCsv({
      key: "technicians",
      filename: "technicians-earnings-report.csv",
      header: "الفني,إجمالي المستحقات,إجمالي المدفوع,المتبقي",
    });
    await checkCsv({
      key: "vehicles",
      filename: "vehicles-fuel-report.csv",
      header: "المركبة,رقم اللوحة,الشهر,تكلفة الوقود,الليترات",
      mustInclude: ["12-345-67"],
    });
    await checkCsv({
      key: "profitability",
      filename: "profitability-report.csv",
      header: "رقم المهمة,العميل,تاريخ الإنشاء,الإيراد,التكلفة المعتمدة,الربح الإجمالي,هامش الربح %",
      mustInclude: ["JOB-2026-0001", "JOB-2026-0008"], // Ahmad's full worked scenario + Yasmin's zero-cost edge case
    });

    if (consoleErrors.length > 0) {
      console.log("\n--- Browser console errors seen during run ---");
      for (const e of consoleErrors) console.log("  ", e);
      failures++;
    }
  } catch (err) {
    console.error("VERIFICATION SCRIPT ERROR:", err);
    await page.screenshot({ path: "/tmp/phase10b-error.png" }).catch(() => {});
    failures++;
  } finally {
    await pool.end();
    await browser.close();
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main();
