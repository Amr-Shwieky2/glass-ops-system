// Manual verification script for Phase 10a (Administration/Operations
// tooling: users/permissions admin, general settings + lookups CRUD, the
// unified approvals queue, and the notifications inbox/bell) — not part of
// the automated test suite. Drives a real headless browser against the
// seeded demo data, plus direct DB reads/writes via the pg Pool for the
// access-control and audit checks that aren't fully observable from the UI.
// Finds jobs by their stable seeded numbers via the UI (never a hardcoded
// row id), same convention as verify-phase5/6/7/8/9.mjs, so it stays valid
// across a fresh `npm run db:seed`. The one exception is the fresh test
// user this script itself creates in Part A — its id is looked up from the
// DB by the phone number this script chose, which is not a "hardcoded row
// id" in the sense the convention warns against (it did not exist before
// this run).
//
// Calls chromium.launch() with no executablePath override (this machine's
// locally-installed Playwright browser), same as verify-phase7/8/9.mjs.
import "dotenv/config";
import { chromium } from "playwright-core";
import { Pool } from "pg";

const BASE_URL = "http://localhost:3000";

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

async function jobHrefByNumber(page, jobNumber) {
  await page.goto(`${BASE_URL}/jobs`, { waitUntil: "networkidle" });
  return page.locator(`a:has-text("${jobNumber}")`).first().getAttribute("href");
}

function pad(n) {
  return String(n).padStart(2, "0");
}
/** Local (not UTC) datetime-local input value — mirrors verify-phase7.mjs's
 * own datetimeLocalValue() exactly, since toISOString() would shift the
 * date across a UTC day boundary depending on the machine's local time. */
function datetimeLocalValue(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Extracts the ILS amount right after a given Arabic label in the page's
 * visible text, e.g. extractAmountAfter(text, "مبلغ العمولة:") -> 300.00. */
function extractAmountAfter(text, label) {
  const idx = text.indexOf(label);
  if (idx === -1) return null;
  const slice = text.slice(idx, idx + label.length + 40);
  const m = slice.match(/[\d,]+\.\d{2}/);
  return m ? Number(m[0].replace(/,/g, "")) : null;
}

async function main() {
  const browser = await chromium.launch();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const employeeCtx = await browser.newContext({ locale: "ar" });
  const page = await employeeCtx.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  const usersRes = await pool.query(
    `select id, phone from users where phone in ('+972501111111','+972502222222','+972503333333','+972504444444')`,
  );
  const idByPhone = Object.fromEntries(usersRes.rows.map((r) => [r.phone, r.id]));
  const amrId = idByPhone["+972501111111"];
  const mohammadId = idByPhone["+972502222222"];
  const issamId = idByPhone["+972503333333"];
  const baselId = idByPhone["+972504444444"];

  // --- DB helpers -----------------------------------------------------
  async function userByPhone(phone) {
    const { rows } = await pool.query(
      `select id, status from users where phone = $1`,
      [phone],
    );
    return rows[0];
  }
  async function userPermissionKeys(userId) {
    const { rows } = await pool.query(
      `select permission_key from user_permissions where user_id = $1 order by permission_key`,
      [userId],
    );
    return rows.map((r) => r.permission_key);
  }
  async function auditRows(action, entityId) {
    const { rows } = await pool.query(
      `select old_value, new_value, user_id from audit_logs where action = $1 and entity_id = $2 order by created_at desc`,
      [action, entityId],
    );
    return rows;
  }
  async function jobStatusActive(key) {
    const { rows } = await pool.query(`select is_active from job_statuses where key = $1`, [key]);
    return rows[0]?.is_active;
  }
  async function workTypeActive(key) {
    const { rows } = await pool.query(`select is_active from work_types where key = $1`, [key]);
    return rows[0]?.is_active;
  }
  async function settingValue(key) {
    const { rows } = await pool.query(`select value from application_settings where key = $1`, [key]);
    return rows[0]?.value;
  }
  async function unreadCount(userId) {
    const { rows } = await pool.query(
      `select count(*)::int as c from notifications where user_id = $1 and is_read = false`,
      [userId],
    );
    return rows[0].c;
  }
  async function pendingApprovalCount(entityType) {
    const { rows } = await pool.query(
      `select count(*)::int as c from approval_requests where entity_type = $1 and status = 'pending'`,
      [entityType],
    );
    return rows[0].c;
  }

  const TEST_PHONE = "0509990001";
  const TEST_PHONE_NORM = "+972509990001";
  const TEST_PASSWORD = "password12345";

  let nabilHref, monaHref, karimHref;
  let testUserId;

  try {
    console.log("=== Setup: locate seeded jobs (Amr) ===");
    await login(page, "0501111111", "password123");
    nabilHref = await jobHrefByNumber(page, "JOB-2026-0005");
    monaHref = await jobHrefByNumber(page, "JOB-2026-0006");
    karimHref = await jobHrefByNumber(page, "JOB-2026-0007");

    // -----------------------------------------------------------------
    // Part A: create a user, grant it a permission, confirm the gated
    // capability now genuinely works — and separately confirm a user who
    // holds MANAGE_USERS but NOT MANAGE_PERMISSIONS cannot toggle any
    // permission checkbox (disabled, not just hidden).
    // -----------------------------------------------------------------
    console.log("\n--- Part A: create user -> grant permission -> gated access; MANAGE_PERMISSIONS-less admin sees read-only checkboxes ---");
    await page.goto(`${BASE_URL}/admin/users`, { waitUntil: "networkidle" });
    await page.click('button:has-text("إضافة مستخدم")');
    let dialog = page.locator('[role="dialog"]');
    await dialog.locator("#name").fill("مستخدم اختبار فيز 10أ");
    await dialog.locator("#phone").fill(TEST_PHONE);
    await dialog.locator("#password").fill(TEST_PASSWORD);
    await dialog.locator('button:has-text("إضافة")').click();
    await page.waitForSelector('[role="dialog"]', { state: "detached", timeout: 10000 });
    await page.waitForTimeout(400);

    let testUser = await userByPhone(TEST_PHONE_NORM);
    testUserId = testUser?.id;
    check("new user actually created in the DB", !!testUserId);
    check("new user starts active with zero permissions", testUser?.status === "active" && (await userPermissionKeys(testUserId)).length === 0);

    await page.goto(`${BASE_URL}/admin/users/${testUserId}`, { waitUntil: "networkidle" });
    let text = await page.innerText("body");
    check("landed on the new user's own detail page", text.includes("مستخدم اختبار فيز 10أ"));

    // Grant CREATE_REPAIR (for the "gated capability now works" check) and
    // MANAGE_USERS (so this same user can reach /admin/users in Part A's
    // second half, without also granting MANAGE_PERMISSIONS).
    const permissionsCard = page.locator('[data-slot="card"]', { hasText: "الصلاحيات" });
    async function toggleCheckbox(labelText) {
      const row = permissionsCard.locator("label", { hasText: labelText });
      await row.locator('button[role="checkbox"]').click();
      await page.waitForTimeout(500);
    }
    await toggleCheckbox("فتح إصلاح");
    await toggleCheckbox("إدارة المستخدمين");
    await page.waitForTimeout(300);

    const grantedKeys = await userPermissionKeys(testUserId);
    check("CREATE_REPAIR actually granted (DB)", grantedKeys.includes("create_repair"));
    check("MANAGE_USERS actually granted (DB)", grantedKeys.includes("manage_users"));
    check("MANAGE_PERMISSIONS was NOT granted (DB)", !grantedKeys.includes("manage_permissions"));

    const grantAuditRows = await auditRows("user_permission.grant", testUserId);
    check(
      "audit log has a user_permission.grant row for CREATE_REPAIR with correct newValue (DB)",
      grantAuditRows.some((r) => r.new_value?.permissionKey === "create_repair") &&
        grantAuditRows.length >= 2,
    );

    // New browser context: log in as the fresh test user and confirm the
    // gated capability (repairs) genuinely now works.
    const testCtx = await browser.newContext({ locale: "ar" });
    const testPage = await testCtx.newPage();
    await login(testPage, TEST_PHONE, TEST_PASSWORD);
    await testPage.goto(`${BASE_URL}/repairs`, { waitUntil: "networkidle" });
    text = await testPage.innerText("body");
    check("test user (granted CREATE_REPAIR) can now open /repairs, not Forbidden", !text.includes("لا تملك صلاحية الوصول لهذه الصفحة"));

    // Same test user also holds MANAGE_USERS (but not MANAGE_PERMISSIONS)
    // — can reach the admin users area, but a permissions checkbox on
    // ANY user's page (including their own) must render disabled, not
    // just hidden, and clicking it must not actually grant anything.
    await testPage.goto(`${BASE_URL}/admin/users/${amrId}`, { waitUntil: "networkidle" });
    text = await testPage.innerText("body");
    check("MANAGE_USERS-holder can open another user's (Amr's) detail page", !text.includes("لا تملك صلاحية الوصول لهذه الصفحة"));
    check("read-only caption shown (viewer lacks MANAGE_PERMISSIONS)", text.includes("للعرض فقط"));

    const readonlyCheckboxes = testPage.locator('[data-slot="card"]', { hasText: "الصلاحيات" }).locator('button[role="checkbox"]');
    const checkboxCount = await readonlyCheckboxes.count();
    let allDisabled = checkboxCount > 0;
    for (let i = 0; i < checkboxCount; i++) {
      if (!(await readonlyCheckboxes.nth(i).isDisabled())) {
        allDisabled = false;
        break;
      }
    }
    check("every permission checkbox on Amr's page is disabled for a MANAGE_PERMISSIONS-less viewer (DOM)", allDisabled);

    const amrKeysBefore = await userPermissionKeys(amrId);
    await readonlyCheckboxes.first().click({ force: true }).catch(() => {});
    await testPage.waitForTimeout(400);
    const amrKeysAfter = await userPermissionKeys(amrId);
    check("forcing a click on a disabled checkbox changed nothing (DB)", amrKeysBefore.length === amrKeysAfter.length);

    // -----------------------------------------------------------------
    // Part B: suspending a user is a REAL access-control check — the
    // suspended user's already-open session is rejected on its very next
    // request, not just a cosmetic status badge on the admin screen.
    // -----------------------------------------------------------------
    console.log("\n--- Part B: suspend a user -> their live session is rejected on the next request ---");
    await page.goto(`${BASE_URL}/admin/users/${testUserId}`, { waitUntil: "networkidle" });
    await page.click('button:has-text("إيقاف المستخدم")');
    await page.locator('[role="alertdialog"]').locator('button:has-text("إيقاف")').click();
    await page.waitForSelector("text=تم إيقاف المستخدم", { timeout: 10000 });
    await page.waitForTimeout(300);

    testUser = await userByPhone(TEST_PHONE_NORM);
    check("user status is now 'suspended' (DB)", testUser?.status === "suspended");
    const statusAuditRows = await auditRows("user.status_change", testUserId);
    check(
      "audit row for the suspension has correct old/new values (DB)",
      statusAuditRows[0]?.old_value?.status === "active" && statusAuditRows[0]?.new_value?.status === "suspended",
    );

    // The SAME already-authenticated browser context (no re-login) now
    // tries to load another page — this is the real check: does the
    // per-request session lookup actually reject them, not merely does
    // the admin screen show a "موقوف" badge.
    await testPage.goto(`${BASE_URL}/dashboard`, { waitUntil: "networkidle" });
    check("suspended user's live session is rejected -> redirected to /login on next request", testPage.url().includes("/login"));

    // A fresh login attempt with the correct password is also rejected,
    // with the dedicated suspension message (not the generic one).
    await testCtx.clearCookies();
    await testPage.goto(`${BASE_URL}/login`, { waitUntil: "networkidle" });
    await testPage.fill("#phone", TEST_PHONE);
    await testPage.fill("#password", TEST_PASSWORD);
    await testPage.click('button[type="submit"]');
    await testPage.waitForSelector("text=تم تعليق هذا الحساب", { timeout: 10000 });
    check("fresh login attempt for the suspended account shows the suspension message", true);
    await testCtx.close();

    // -----------------------------------------------------------------
    // Part C: editing a general setting (commission_rate_percent) changes
    // real downstream behavior — Phase 8's commission estimate. Karim's
    // job (JOB-2026-0007) has salePriceTotal=3000.00, zero job_costs, and
    // NO commission row yet, so estimating at 10% -> 300.00 and at 20% ->
    // 600.00 is a clean, unambiguous before/after.
    // -----------------------------------------------------------------
    console.log("\n--- Part C: commission_rate_percent setting change -> real commission estimate changes ---");
    const rateBefore = await settingValue("commission_rate_percent");
    check("commission_rate_percent starts at the seeded default (10)", Number(rateBefore) === 10);

    await page.goto(`${BASE_URL}${karimHref}`, { waitUntil: "networkidle" });
    const compCard = page.locator('[data-slot="card"]', { hasText: "تعويض الفنيين" });
    await compCard.locator('button:has-text("تقدير العمولة")').click();
    await page.waitForTimeout(700);
    text = await page.innerText("body");
    const amountBefore = extractAmountAfter(text, "مبلغ العمولة:");
    check("commission estimated at 10% = 300.00 before the setting change", amountBefore === 300);

    await page.goto(`${BASE_URL}/settings`, { waitUntil: "networkidle" });
    const commissionInput = page.locator("#commissionRatePercent");
    await commissionInput.fill("20");
    await page.click('button:has-text("حفظ الإعدادات العامة")');
    await page.waitForSelector("text=تم حفظ الإعدادات العامة", { timeout: 10000 });
    check("commission_rate_percent now 20 in the DB", Number(await settingValue("commission_rate_percent")) === 20);

    await page.goto(`${BASE_URL}${karimHref}`, { waitUntil: "networkidle" });
    await compCard.locator('button:has-text("تقدير العمولة")').click();
    await page.waitForTimeout(700);
    text = await page.innerText("body");
    const amountAfter = extractAmountAfter(text, "مبلغ العمولة:");
    check("commission re-estimated at 20% = 600.00 after the setting change (real downstream effect)", amountAfter === 600);

    // Restore the default so it doesn't leak into anyone else's demo/testing.
    await page.goto(`${BASE_URL}/settings`, { waitUntil: "networkidle" });
    await page.locator("#commissionRatePercent").fill("10");
    await page.click('button:has-text("حفظ الإعدادات العامة")');
    await page.waitForSelector("text=تم حفظ الإعدادات العامة", { timeout: 10000 });
    check("commission_rate_percent restored to 10 (DB)", Number(await settingValue("commission_rate_percent")) === 10);

    // -----------------------------------------------------------------
    // Part D: deactivating a job status / work type that's currently in
    // use is rejected with a clear Arabic error (row stays active); one
    // that's genuinely unused deactivates cleanly.
    // -----------------------------------------------------------------
    console.log("\n--- Part D: deactivate-in-use rejected; deactivate-unused succeeds (job statuses + work types) ---");
    await page.goto(`${BASE_URL}/settings`, { waitUntil: "networkidle" });
    await page.click('button:has-text("حالات المهام")');
    await page.waitForTimeout(200);

    const installedRow = page.locator("tr", { hasText: "installed" });
    await installedRow.locator('[role="switch"]').click();
    await page.waitForSelector("text=لا يمكن تعطيل هذه الحالة", { timeout: 10000 });
    check("deactivating 'installed' (in use by Karim's job) was rejected with a clear error", true);
    check("'installed' status is still active (DB)", (await jobStatusActive("installed")) === true);

    const cancelledRow = page.locator("tr", { hasText: "cancelled" });
    await cancelledRow.locator('[role="switch"]').click();
    await page.waitForTimeout(700);
    check("'cancelled' status (genuinely unused by any job) deactivated successfully (DB)", (await jobStatusActive("cancelled")) === false);

    await page.click('button:has-text("أنواع العمل")');
    await page.waitForTimeout(200);
    const railingRow = page.locator("tr", { hasText: "glass_railing" });
    await railingRow.locator('[role="switch"]').click();
    await page.waitForSelector("text=لا يمكن تعطيل نوع العمل هذا", { timeout: 10000 });
    check("deactivating 'glass_railing' (in use by job items + a compensation rule) was rejected", true);
    check("'glass_railing' work type is still active (DB)", (await workTypeActive("glass_railing")) === true);

    const otherRow = page.locator("tr", { hasText: "other" });
    await otherRow.locator('[role="switch"]').click();
    await page.waitForTimeout(700);
    check("'other' work type (genuinely unused) deactivated successfully (DB)", (await workTypeActive("other")) === false);

    // -----------------------------------------------------------------
    // Part E: the approvals queue lists a pending item from EACH of the
    // four entity types, and each row's "عرض" link lands on a page with
    // real, working approve/reject controls — not a dead end. Three of
    // the four are already pending from the seed (Nabil's job); a
    // factory_submission is created live here (Nabil's job also has no
    // production request yet, so this is a fresh send -> submit).
    // -----------------------------------------------------------------
    console.log("\n--- Part E: approvals queue covers all four entity types, each linking to real decision controls ---");
    check("customer_payment already pending from seed (DB)", (await pendingApprovalCount("customer_payment")) >= 1);
    check("technician_ledger_entry already pending from seed (DB)", (await pendingApprovalCount("technician_ledger_entry")) >= 1);
    check("job_cost already pending from seed (DB)", (await pendingApprovalCount("job_cost")) >= 1);

    await page.goto(`${BASE_URL}${nabilHref}`, { waitUntil: "networkidle" });
    await page.click('button:has-text("إرسال إلى المصنع")');
    dialog = page.locator('[role="dialog"]');
    await dialog.locator('button:has-text("إرسال إلى المصنع")').click();
    await page.waitForSelector("text=تم إنشاء طلب الإنتاج", { timeout: 10000 });
    const nabilFactoryLink = await dialog.locator("input[readonly]").inputValue();
    await dialog.locator('button:has-text("تم")').click();
    await page.waitForTimeout(300);

    const factoryCtx = await browser.newContext({ locale: "ar" });
    const factoryPage = await factoryCtx.newPage();
    await factoryPage.goto(nabilFactoryLink, { waitUntil: "networkidle" });
    await factoryPage.fill("#submittedPrice", "999");
    await factoryPage.locator('button:has-text("إرسال السعر")').click();
    await factoryPage.waitForSelector("text=تم استلام عرضكم", { timeout: 10000 });
    await factoryCtx.close();

    check("factory_submission now pending, created live (DB)", (await pendingApprovalCount("factory_submission")) >= 1);

    await page.goto(`${BASE_URL}/approvals`, { waitUntil: "networkidle" });
    text = await page.innerText("body");
    check("approvals queue shows دفعة عميل (customer_payment)", text.includes("دفعة عميل"));
    check("approvals queue shows قيد حساب فني (technician_ledger_entry)", text.includes("قيد حساب فني"));
    check("approvals queue shows تكلفة مهمة (job_cost)", text.includes("تكلفة مهمة"));
    check("approvals queue shows سعر مصنع (factory_submission)", text.includes("سعر مصنع"));

    // Each "عرض" link lands on a page with real approve/reject controls.
    const rows = page.locator("tbody tr");
    const rowCount = await rows.count();
    const viewedHrefs = new Set();
    for (let i = 0; i < rowCount; i++) {
      const row = rows.nth(i);
      const badgeText = (await row.locator('[data-slot="badge"]').innerText()).trim();
      const href = await row.locator('a:has-text("عرض")').getAttribute("href");
      viewedHrefs.add(`${badgeText}::${href}`);
    }
    for (const entry of viewedHrefs) {
      const [label, href] = entry.split("::");
      await page.goto(`${BASE_URL}${href}`, { waitUntil: "networkidle" });
      const approveCount = await page.locator('button:has-text("اعتماد")').count();
      const rejectCount = await page.locator('button:has-text("رفض")').count();
      check(`"${label}" row's عرض link (${href}) shows real decision controls (approve+reject present)`, approveCount >= 1 && rejectCount >= 1);
    }

    // -----------------------------------------------------------------
    // Part F: a real action from an earlier phase (scheduling an
    // appointment, which notifies assignees per Phase 7) produces a
    // notification the assignee can see in their bell/inbox, and marking
    // it read updates the unread count.
    // -----------------------------------------------------------------
    console.log("\n--- Part F: scheduling an appointment notifies the assignee; marking read updates the count ---");
    const issamUnreadBefore = await unreadCount(issamId);

    await page.goto(`${BASE_URL}${monaHref}`, { waitUntil: "networkidle" });
    await page.click('button:has-text("جدولة موعد")');
    dialog = page.locator('[role="dialog"]');
    const start = new Date();
    start.setDate(start.getDate() + 3);
    start.setHours(10, 0, 0, 0);
    await dialog.locator("#scheduledStart").fill(datetimeLocalValue(start)); // measurement type is the dialog's default
    await dialog.locator(`#assignee-${issamId}`).click();
    await dialog.locator('button:has-text("جدولة")').click();
    await page.waitForSelector("text=تم جدولة الموعد بنجاح", { timeout: 10000 });
    await page.waitForTimeout(400);

    const issamUnreadAfter = await unreadCount(issamId);
    check("Issam's unread count increased by exactly 1 after being assigned (DB)", issamUnreadAfter === issamUnreadBefore + 1);

    const issamCtx = await browser.newContext({ locale: "ar" });
    const issamPage = await issamCtx.newPage();
    await login(issamPage, "0503333333", "password123");
    await issamPage.goto(`${BASE_URL}/dashboard`, { waitUntil: "networkidle" });
    await issamPage.click('button[aria-label="الإشعارات"]');
    await issamPage.waitForSelector('[data-slot="popover-content"]', { timeout: 10000 });
    await issamPage.waitForSelector("text=جارٍ التحميل", { state: "detached", timeout: 10000 }).catch(() => {});
    await issamPage.waitForTimeout(500);
    const popoverText = await issamPage.locator('[data-slot="popover-content"]').innerText();
    check("bell popover shows the new appointment notification", popoverText.includes("موعد"));

    // Click the newest (unread) notification to mark it read.
    const firstNotification = issamPage.locator('[data-slot="popover-content"] ul li button').first();
    await firstNotification.click();
    await issamPage.waitForTimeout(500);
    const issamUnreadAfterRead = await unreadCount(issamId);
    check("clicking the notification marked it read -> unread count back down by 1 (DB)", issamUnreadAfterRead === issamUnreadAfter - 1);
    await issamCtx.close();

    // -----------------------------------------------------------------
    // Part G: a real action (granting a permission, Part A above) is
    // visible in the audit log UI with correct old/new values.
    // -----------------------------------------------------------------
    console.log("\n--- Part G: audit log UI shows the real permission-grant action with correct values ---");
    await page.goto(`${BASE_URL}/admin/audit-log`, { waitUntil: "networkidle" });
    text = await page.innerText("body");
    check("audit log is non-empty (real actions have happened this run)", !text.includes("لا توجد أحداث"));
    check("audit log lists the user_permission.grant action", text.includes("user_permission.grant"));

    const grantRow = page.locator("tr", { hasText: "user_permission.grant" }).first();
    await grantRow.locator("summary").click();
    const grantRowText = await grantRow.innerText();
    check("that row's expanded details show the granted permission key", grantRowText.includes("create_repair") || grantRowText.includes("manage_users"));

    // -----------------------------------------------------------------
    // Part H: permission-denial DOM-absence checks for the five
    // administration permissions — Issam holds none of them.
    // -----------------------------------------------------------------
    console.log("\n--- Part H: permission-denial DOM-absence checks (Issam holds none of the 5 admin permissions) ---");
    await employeeCtx.clearCookies();
    await login(page, "0503333333", "password123"); // Issam
    await page.goto(`${BASE_URL}/dashboard`, { waitUntil: "networkidle" });
    text = await page.innerText("body");
    check("nav has no 'المستخدمون والصلاحيات' link (no MANAGE_USERS/MANAGE_PERMISSIONS)", !text.includes("المستخدمون والصلاحيات"));
    check("nav has no 'سجل التدقيق' link (no VIEW_AUDIT_LOG)", !text.includes("سجل التدقيق"));
    check("nav has no 'الإعدادات' link (no MANAGE_SETTINGS)", !text.includes("الإعدادات"));
    check("nav has no 'طلبات الموافقة' link (no APPROVE_REQUESTS)", !text.includes("طلبات الموافقة"));

    for (const path of ["/admin/users", "/admin/audit-log", "/settings", "/approvals"]) {
      await page.goto(`${BASE_URL}${path}`, { waitUntil: "networkidle" });
      text = await page.innerText("body");
      check(`direct navigation to ${path} shows Forbidden for Issam`, text.includes("لا تملك صلاحية الوصول لهذه الصفحة"));
    }

    if (consoleErrors.length > 0) {
      console.log("\n--- Browser console errors seen during run ---");
      for (const e of consoleErrors) console.log("  ", e);
      failures++;
    }
  } catch (err) {
    console.error("VERIFICATION SCRIPT ERROR:", err);
    await page.screenshot({ path: "/tmp/phase10a-error.png" }).catch(() => {});
    failures++;
  } finally {
    await pool.end();
    await browser.close();
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main();
