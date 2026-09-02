// Manual verification script for Phase 8 (technician compensation/ledger,
// job costs, cash boxes/transfers, checks — both backend halves and both
// UI halves: jobs/[id]'s Costs/Compensation sections and the standalone
// /finance area) — not part of the automated test suite. Drives a real
// headless browser against the seeded demo data, plus direct DB reads/
// writes via the pg Pool for the financial-integrity, race-safety, and
// permission-scoping checks that aren't fully observable from the UI.
// Finds jobs by their stable seeded numbers via the UI (never a hardcoded
// row id), same convention as verify-phase5/6/7.mjs, so it stays valid
// across a fresh `npm run db:seed`.
//
// Calls chromium.launch() with no executablePath override (this machine's
// locally-installed Playwright browser), same as verify-phase7.mjs.
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
function isoDateNDaysFromNow(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
/** Matches formatILS(amount) whether or not the thousands comma renders,
 * ignoring the currency symbol / bidi marks around it (same tolerant
 * convention as verify-phase7.mjs's inline money regexes). */
function moneyPattern(amount) {
  const num = Number(amount);
  const sign = num < 0 ? "-" : "";
  const abs = Math.abs(num);
  const grouped = abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const plain = abs.toFixed(2);
  return new RegExp(escapeRegex(sign + grouped) + "|" + escapeRegex(sign + plain));
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
  async function jobIdByNumber(jobNumber) {
    const { rows } = await pool.query(`select id from jobs where job_number = $1`, [jobNumber]);
    return rows[0]?.id;
  }
  async function approvedLedgerBalance(userId) {
    const { rows } = await pool.query(
      `select coalesce(sum(amount::numeric), 0)::text as bal from technician_ledger_entries
       where user_id = $1 and approval_status = 'approved'`,
      [userId],
    );
    return Number(rows[0].bal);
  }
  async function latestLedgerEntries(userId, entryType, limit = 1) {
    const { rows } = await pool.query(
      `select id, amount::text as amount, approval_status, description, related_job_id, created_by_user_id
       from technician_ledger_entries
       where user_id = $1 and entry_type = $2
       order by created_at desc limit $3`,
      [userId, entryType, limit],
    );
    return rows;
  }
  async function ledgerEntriesForJob(jobId, entryType) {
    const { rows } = await pool.query(
      `select user_id, amount::text as amount, approval_status
       from technician_ledger_entries
       where related_job_id = $1 and entry_type = $2
       order by created_at desc`,
      [jobId, entryType],
    );
    return rows;
  }
  async function jobCostsForJob(jobId, category) {
    const { rows } = await pool.query(
      `select vendor_user_id, amount::text as amount, status, ledger_entry_id
       from job_costs where job_id = $1 and category = $2
       order by created_at desc`,
      [jobId, category],
    );
    return rows;
  }
  async function jobTotalApproved(jobId) {
    const { rows } = await pool.query(
      `select coalesce(sum(amount::numeric), 0)::text as total from job_costs
       where job_id = $1 and status = 'approved'`,
      [jobId],
    );
    return Number(rows[0].total);
  }
  async function commissionRow(jobId) {
    const { rows } = await pool.query(`select * from commissions where job_id = $1`, [jobId]);
    return rows[0] ?? null;
  }
  async function cashAccountId(ownerType, ownerUserId) {
    const { rows } = await pool.query(
      ownerType === "company"
        ? `select id from cash_accounts where owner_type = 'company'`
        : `select id from cash_accounts where owner_type = 'user' and owner_user_id = $1`,
      ownerType === "company" ? [] : [ownerUserId],
    );
    return rows[0]?.id;
  }
  async function cashBalance(accountId) {
    const { rows } = await pool.query(
      `select coalesce(sum(case when direction = 'in' then amount::numeric else -amount::numeric end), 0)::text as bal
       from cash_transactions where cash_account_id = $1`,
      [accountId],
    );
    return Number(rows[0].bal);
  }
  async function grantPermission(userId, key) {
    await pool.query(
      `insert into user_permissions (user_id, permission_key, granted_by_user_id)
       values ($1, $2, $3) on conflict do nothing`,
      [userId, key, amrId],
    );
  }
  async function revokePermission(userId, key) {
    await pool.query(`delete from user_permissions where user_id = $1 and permission_key = $2`, [userId, key]);
  }

  let nabilHref, reemHref, monaHref, ahmadHref;
  let nabilJobId, reemJobId, monaJobId, ahmadCustomerId;

  try {
    console.log("=== Setup: locate seeded jobs ===");
    await login(page, "0502222222", "password123"); // Mohammad
    nabilHref = await jobHrefByNumber(page, "JOB-2026-0005");
    reemHref = await jobHrefByNumber(page, "JOB-2026-0004");
    monaHref = await jobHrefByNumber(page, "JOB-2026-0006");
    ahmadHref = await jobHrefByNumber(page, "JOB-2026-0001");
    nabilJobId = await jobIdByNumber("JOB-2026-0005");
    reemJobId = await jobIdByNumber("JOB-2026-0004");
    monaJobId = await jobIdByNumber("JOB-2026-0006");
    const { rows: ahmadCustRows } = await pool.query(
      `select customer_id from jobs where job_number = 'JOB-2026-0001'`,
    );
    ahmadCustomerId = ahmadCustRows[0].customer_id;

    // -----------------------------------------------------------------
    // Part A: allocate installation earnings to two technicians on one
    // job, different amounts — never an equal split.
    // -----------------------------------------------------------------
    console.log("\n--- Part A: allocate installation earnings (Issam 800.00, Basel 300.00) on Nabil's job ---");
    await page.goto(`${BASE_URL}${nabilHref}`, { waitUntil: "networkidle" });

    async function allocateEarning(technicianName, customAmount) {
      await page.click('button:has-text("تخصيص تعويض تركيب")');
      const dialog = page.locator('[role="dialog"]');
      await dialog.locator("#userId").click();
      await page.locator(`[role="option"]:has-text("${technicianName}")`).click();
      await dialog.locator('button:has-text("مبلغ مخصص")').click();
      await dialog.locator("#customDescription").fill(`تركيب زجاج — اختبار فيز 8 (${technicianName})`);
      await dialog.locator("#customAmount").fill(customAmount);
      await dialog.locator('button:has-text("تخصيص المستحق")').click();
      await page.waitForSelector("text=تم تخصيص المستحق", { timeout: 10000 });
      await page.waitForTimeout(400);
    }
    await allocateEarning("عصام", "800");
    await allocateEarning("باسل", "300");

    let earnings = await ledgerEntriesForJob(nabilJobId, "installation_earning");
    check("two installation_earning entries created on Nabil's job (DB)", earnings.length === 2);
    check(
      "Issam's entry is 800.00, approved (DB)",
      earnings.some((e) => e.user_id === issamId && e.amount === "800.00" && e.approval_status === "approved"),
    );
    check(
      "Basel's entry is 300.00, approved — a DIFFERENT amount than Issam's (DB)",
      earnings.some((e) => e.user_id === baselId && e.amount === "300.00" && e.approval_status === "approved"),
    );
    let laborCosts = await jobCostsForJob(nabilJobId, "installer_labor");
    check("two paired installer_labor job_costs rows exist (DB)", laborCosts.length === 2);
    check(
      "paired job_costs rows carry the matching vendor/amount/ledger_entry_id and are approved (DB)",
      laborCosts.every((c) => c.status === "approved" && c.ledger_entry_id) &&
        laborCosts.some((c) => c.vendor_user_id === issamId && c.amount === "800.00") &&
        laborCosts.some((c) => c.vendor_user_id === baselId && c.amount === "300.00"),
    );

    // -----------------------------------------------------------------
    // Part B: a bonus and a penalty (with a reason) on the same technician
    // — correct sign, balance recomputes.
    // -----------------------------------------------------------------
    console.log("\n--- Part B: bonus + penalty (with reason) on Basel ---");
    await page.click('button:has-text("مكافأة")');
    let dialog = page.locator('[role="dialog"]');
    await dialog.locator("#bonus-userId").click();
    await page.locator('[role="option"]:has-text("باسل")').click();
    await dialog.locator("#bonus-customDescription").fill("فيديو شكر من عميل — اختبار فيز 8");
    await dialog.locator("#bonus-amount").fill("50");
    await dialog.locator('button:has-text("تسجيل المكافأة")').click();
    await page.waitForSelector("text=تم تسجيل المكافأة", { timeout: 10000 });
    await page.waitForTimeout(400);

    const penaltyReason = "تأخر عن العميل ساعة كاملة دون إشعار مسبق.";
    await page.click('button:has-text("غرامة")');
    dialog = page.locator('[role="dialog"]');
    await dialog.locator("#penalty-userId").click();
    await page.locator('[role="option"]:has-text("باسل")').click();
    await dialog.locator("#penalty-customDescription").fill("تأخر عن موعد العميل");
    await dialog.locator("#penalty-reason").fill(penaltyReason);
    await dialog.locator("#penalty-amount").fill("80");
    await dialog.locator('button:has-text("تسجيل المخالفة")').click();
    await page.waitForSelector("text=تم تسجيل المخالفة", { timeout: 10000 });
    await page.waitForTimeout(400);

    const [bonusRow] = await latestLedgerEntries(baselId, "bonus", 1);
    check("Basel's bonus recorded at +50.00, approved (DB)", bonusRow?.amount === "50.00" && bonusRow?.approval_status === "approved");
    const [penaltyRow] = await latestLedgerEntries(baselId, "penalty", 1);
    check(
      "Basel's penalty recorded at -80.00 (negative sign), approved, with the reason in its description (DB)",
      penaltyRow?.amount === "-80.00" &&
        penaltyRow?.approval_status === "approved" &&
        (penaltyRow?.description ?? "").includes(penaltyReason),
    );

    let baselBalance = await approvedLedgerBalance(baselId);
    check(
      "Basel's balance recomputes correctly: 450 (seed daily wage) + 300 (Part A) + 50 (bonus) - 80 (penalty) = 720.00 (DB)",
      baselBalance === 720,
    );

    await page.reload({ waitUntil: "networkidle" });
    let text = await page.innerText("body");
    check("Nabil job's Costs total reflects both installer_labor allocations (800+300 = 1,100.00)", moneyPattern("1100.00").test(text));

    // -----------------------------------------------------------------
    // Part C: estimate then finalize a commission on Reem's job (deal
    // closer = Mohammad, sale price 6,500.00, approved job costs 2,100.00
    // factory_glass only -> gross profit 4,400.00 -> 10% = 440.00).
    // Then finalize a SECOND time (a stale page that loaded before the
    // first finalize) and confirm it's rejected, not double-counted —
    // the same double-decide race class already found/fixed in Phase 7.
    // -----------------------------------------------------------------
    console.log("\n--- Part C: estimate + finalize commission on Reem's job, then a stale double-finalize ---");
    await page.goto(`${BASE_URL}${reemHref}`, { waitUntil: "networkidle" });
    await page.click('button:has-text("تقدير العمولة")');
    await page.waitForSelector("text=تم تحديث تقدير العمولة", { timeout: 10000 });
    await page.waitForTimeout(400);

    let commission = await commissionRow(reemJobId);
    check(
      "commission estimated: gross profit 4,400.00, amount 440.00, rate 10.00% (DB)",
      commission?.status === "estimated" &&
        commission?.estimated_gross_profit === "4400.00" &&
        commission?.estimated_amount === "440.00" &&
        commission?.rate_percent === "10.00",
    );

    // A second manager context opens the SAME job page now, while the
    // commission is still only estimated — its DOM keeps the finalize
    // button even after the first context finalizes below.
    const staleCtx = await browser.newContext({ locale: "ar" });
    const stalePage = await staleCtx.newPage();
    await login(stalePage, "0502222222", "password123"); // Mohammad, second session
    await stalePage.goto(`${BASE_URL}${reemHref}`, { waitUntil: "networkidle" });

    await page.click('button:has-text("اعتماد العمولة النهائية")');
    await page.waitForSelector("text=تم اعتماد العمولة النهائية", { timeout: 10000 });
    await page.waitForTimeout(400);

    commission = await commissionRow(reemJobId);
    check(
      "commission finalized: final gross profit 4,400.00, final amount 440.00, ledger_entry_id set (DB)",
      commission?.status === "finalized" &&
        commission?.final_gross_profit === "4400.00" &&
        commission?.final_amount === "440.00" &&
        !!commission?.ledger_entry_id,
    );
    let commissionEntries = await ledgerEntriesForJob(reemJobId, "commission");
    check(
      "exactly one 'commission' ledger entry exists for Reem's job, 440.00, approved (DB)",
      commissionEntries.length === 1 &&
        commissionEntries[0].amount === "440.00" &&
        commissionEntries[0].approval_status === "approved",
    );

    // The stale page's finalize button is still in its DOM — click it.
    await stalePage.click('button:has-text("اعتماد العمولة النهائية")');
    await stalePage.waitForSelector("text=تم اعتماد العمولة النهائية لهذه المهمة بالفعل", { timeout: 10000 });
    await stalePage.waitForTimeout(400);

    commissionEntries = await ledgerEntriesForJob(reemJobId, "commission");
    check(
      "a second (stale) finalize call was rejected — still exactly ONE commission ledger entry, not two (DB)",
      commissionEntries.length === 1,
    );
    commission = await commissionRow(reemJobId);
    check(
      "commission figures unchanged by the rejected second call (still 4,400.00 / 440.00) (DB)",
      commission?.final_gross_profit === "4400.00" && commission?.final_amount === "440.00",
    );
    await staleCtx.close();

    // -----------------------------------------------------------------
    // Part D: Basel (lacks MANAGE_TECHNICIAN_PAYMENTS) self-reports a
    // payment received -> lands pending, no effect on his balance (a
    // balance is a SUM over approved rows only) -> a
    // MANAGE_TECHNICIAN_PAYMENTS holder approves it -> balance reflects it.
    // -----------------------------------------------------------------
    console.log("\n--- Part D: Basel self-reports a payment, pending -> approved ---");
    await employeeCtx.clearCookies();
    await login(page, "0504444444", "password123"); // Basel
    await page.goto(`${BASE_URL}/finance/technicians/${baselId}`, { waitUntil: "networkidle" });
    await page.click('button:has-text("الإبلاغ عن دفعة مستلمة")');
    dialog = page.locator('[role="dialog"]');
    await dialog.locator("#report-amount").fill("150");
    await dialog.locator("#report-note").fill("دفعة اختبار فيز 8");
    await dialog.locator('button:has-text("إرسال")').click();
    await page.waitForSelector("text=تم إرسال البلاغ", { timeout: 10000 });
    await page.waitForTimeout(400);

    const [reportedRow] = await latestLedgerEntries(baselId, "payment_made", 1);
    check(
      "self-reported payment lands as -150.00, pending, created by Basel himself (DB)",
      reportedRow?.amount === "-150.00" &&
        reportedRow?.approval_status === "pending" &&
        reportedRow?.created_by_user_id === baselId,
    );
    baselBalance = await approvedLedgerBalance(baselId);
    check("Basel's balance UNCHANGED while the report is pending — still 720.00 (DB)", baselBalance === 720);

    await employeeCtx.clearCookies();
    await login(page, "0502222222", "password123"); // Mohammad (has MANAGE_TECHNICIAN_PAYMENTS)
    await page.goto(`${BASE_URL}/finance/technicians/${baselId}`, { waitUntil: "networkidle" });
    const reportRow150 = page.locator("li", { hasText: "150.00" }).filter({ hasText: "بانتظار الاعتماد" });
    await reportRow150.locator('button:has-text("اعتماد")').click();
    await page.locator('[role="alertdialog"]').locator('button:has-text("اعتماد")').click();
    await page.waitForSelector("text=تم اعتماد القيد", { timeout: 10000 });
    await page.waitForTimeout(400);

    const reportedNow = (await latestLedgerEntries(baselId, "payment_made", 5)).find((r) => r.amount === "-150.00");
    check("the -150.00 report is now approved (DB)", reportedNow?.approval_status === "approved");
    baselBalance = await approvedLedgerBalance(baselId);
    check("Basel's balance now reflects the approved payment: 720 - 150 = 570.00 (DB)", baselBalance === 570);

    // The seeded pending -200.00 report (Issam's job, from stage-3 seed
    // data) is deliberately left untouched — reused below in Part G as
    // the object of a permission-denial DOM-absence check.
    const seededPending = await pool.query(
      `select approval_status from technician_ledger_entries
       where user_id = $1 and entry_type = 'payment_made' and amount = '-200.00'`,
      [baselId],
    );
    check("the seeded -200.00 pending report is untouched (still pending) (DB)", seededPending.rows[0]?.approval_status === "pending");

    // -----------------------------------------------------------------
    // Part E: a cash transfer — create as the holder (Mohammad), confirm
    // as a MANAGE_TECHNICIAN_PAYMENTS holder (Amr), verify both accounts'
    // computed balances moved by EXACTLY the transfer amount.
    // -----------------------------------------------------------------
    console.log("\n--- Part E: cash handover (Mohammad -> company), confirmed by Amr ---");
    const mohammadCashId = await cashAccountId("user", mohammadId);
    const companyCashId = await cashAccountId("company");
    const mohammadBalanceBefore = await cashBalance(mohammadCashId);
    const companyBalanceBefore = await cashBalance(companyCashId);

    await employeeCtx.clearCookies();
    await login(page, "0502222222", "password123"); // Mohammad
    await page.goto(`${BASE_URL}/finance`, { waitUntil: "networkidle" });
    await page.click('button:has-text("تسليم نقدية")');
    dialog = page.locator('[role="dialog"]');
    await dialog.locator("#transfer-amount").fill("1000");
    await dialog.locator("#transfer-notes").fill("تسليم اختبار فيز 8");
    await dialog.locator('button:has-text("تسليم")').click();
    await page.waitForSelector("text=تم تسجيل عملية التسليم", { timeout: 10000 });
    await page.waitForTimeout(400);

    const { rows: newTransferRows } = await pool.query(
      `select id, amount::text as amount, confirmed_at from cash_transfers
       where from_cash_account_id = $1 and to_cash_account_id = $2
       order by created_at desc limit 1`,
      [mohammadCashId, companyCashId],
    );
    const newTransfer = newTransferRows[0];
    check("new cash_transfers row created, 1,000.00, unconfirmed (DB)", newTransfer?.amount === "1000.00" && newTransfer?.confirmed_at === null);
    check(
      "no money moved yet — Mohammad's cash balance unaffected before confirmation (DB)",
      (await cashBalance(mohammadCashId)) === mohammadBalanceBefore,
    );

    await employeeCtx.clearCookies();
    await login(page, "0501111111", "password123"); // Amr (MANAGE_TECHNICIAN_PAYMENTS)
    await page.goto(`${BASE_URL}/finance`, { waitUntil: "networkidle" });
    const transferRow = page.locator("li", { hasText: "1,000.00" }).filter({ hasText: "من محمد" });
    await transferRow.locator('button:has-text("تأكيد الاستلام")').click();
    await page.locator('[role="alertdialog"]').locator('button:has-text("تأكيد")').click();
    await page.waitForSelector("text=تم تأكيد الاستلام", { timeout: 10000 });
    await page.waitForTimeout(400);

    const { rows: postConfirmTransfer } = await pool.query(
      `select confirmed_at, confirmed_by_user_id from cash_transfers where id = $1`,
      [newTransfer.id],
    );
    check("transfer now confirmed, by Amr (DB)", postConfirmTransfer[0]?.confirmed_at !== null && postConfirmTransfer[0]?.confirmed_by_user_id === amrId);
    const { rows: postConfirmTx } = await pool.query(
      `select cash_account_id, direction, amount::text as amount from cash_transactions where source_type = 'transfer' and source_id = $1`,
      [newTransfer.id],
    );
    check(
      "exactly two cash_transactions rows posted (one out, one in), both 1,000.00 (DB)",
      postConfirmTx.length === 2 &&
        postConfirmTx.some((t) => t.cash_account_id === mohammadCashId && t.direction === "out" && t.amount === "1000.00") &&
        postConfirmTx.some((t) => t.cash_account_id === companyCashId && t.direction === "in" && t.amount === "1000.00"),
    );
    const mohammadBalanceAfter = await cashBalance(mohammadCashId);
    const companyBalanceAfter = await cashBalance(companyCashId);
    check(
      "Mohammad's cash balance moved by EXACTLY -1,000.00 (DB)",
      mohammadBalanceBefore - mohammadBalanceAfter === 1000,
    );
    check(
      "Company's cash balance moved by EXACTLY +1,000.00 (DB)",
      companyBalanceAfter - companyBalanceBefore === 1000,
    );

    // -----------------------------------------------------------------
    // Part F: a general job cost (hardware) added by a MANAGE_JOB_COSTS
    // holder WITHOUT APPROVE_REQUESTS -> pending, excluded from the
    // approved total -> approved by an APPROVE_REQUESTS holder -> counted.
    // Mirrors verify-phase7.mjs's temporary-revoke-then-restore pattern
    // (Mohammad normally holds both, so APPROVE_REQUESTS is revoked for
    // the pending half of this test, then restored).
    // -----------------------------------------------------------------
    console.log("\n--- Part F: add a job cost without APPROVE_REQUESTS (pending), then approve it ---");
    await revokePermission(mohammadId, "approve_requests");
    try {
      await employeeCtx.clearCookies();
      await login(page, "0502222222", "password123"); // Mohammad, now without approve_requests
      await page.goto(`${BASE_URL}${monaHref}`, { waitUntil: "networkidle" });
      let costsCard = page.locator('[data-slot="card"]', { hasText: "التكاليف" });
      check("Mohammad (still has manage_job_costs) sees the add-cost trigger", (await costsCard.locator('button:has-text("إضافة تكلفة")').count()) === 1);

      await costsCard.locator('button:has-text("إضافة تكلفة")').click();
      dialog = page.locator('[role="dialog"]');
      await dialog.locator("#amount").fill("420");
      await dialog.locator("#description").fill("زجاج احتياطي — اختبار فيز 8");
      await dialog.locator('button:has-text("إضافة التكلفة")').click();
      await page.waitForSelector("text=تم تسجيل التكلفة", { timeout: 10000 });
      await page.waitForTimeout(400);

      const { rows: pendingCostRows } = await pool.query(
        `select status, created_by_user_id from job_costs
         where job_id = $1 and category = 'hardware' and amount = '420.00'
         order by created_at desc limit 1`,
        [monaJobId],
      );
      check("new hardware job cost lands 'pending' (no approve_requests) (DB)", pendingCostRows[0]?.status === "pending" && pendingCostRows[0]?.created_by_user_id === mohammadId);
      check("Mona job's approved cost total is still 0.00 while pending (DB)", (await jobTotalApproved(monaJobId)) === 0);

      await page.reload({ waitUntil: "networkidle" });
      costsCard = page.locator('[data-slot="card"]', { hasText: "التكاليف" });
      check(
        "no approve/reject controls shown for the pending cost — Mohammad currently lacks approve_requests",
        (await costsCard.locator('button:has-text("اعتماد")').count()) === 0 && (await costsCard.locator('button:has-text("رفض")').count()) === 0,
      );
    } finally {
      await grantPermission(mohammadId, "approve_requests");
    }

    await page.goto(`${BASE_URL}${monaHref}`, { waitUntil: "networkidle" }); // fresh request re-reads permissions
    let costsCard = page.locator('[data-slot="card"]', { hasText: "التكاليف" });
    check("approve_requests restored — the pending cost's decision buttons are now visible", (await costsCard.locator('button:has-text("اعتماد")').count()) >= 1);
    await costsCard.locator('button:has-text("اعتماد")').first().click();
    await page.locator('[role="alertdialog"]').locator('button:has-text("اعتماد")').click();
    await page.waitForSelector("text=تم اعتماد التكلفة", { timeout: 10000 });
    await page.waitForTimeout(400);

    const { rows: approvedCostRows } = await pool.query(
      `select status, approved_by_user_id from job_costs where job_id = $1 and category = 'hardware' and amount = '420.00'`,
      [monaJobId],
    );
    check("the job cost is now approved, by Mohammad (DB)", approvedCostRows[0]?.status === "approved" && approvedCostRows[0]?.approved_by_user_id === mohammadId);
    check("Mona job's approved cost total now counts it: 420.00 (DB)", (await jobTotalApproved(monaJobId)) === 420);
    await page.reload({ waitUntil: "networkidle" });
    text = await page.innerText("body");
    check("Mona job's Costs section total now shows 420.00 in the UI", moneyPattern("420.00").test(text));

    // -----------------------------------------------------------------
    // Part G: an incoming check created, then moved through explicit
    // status changes (future -> deposited -> cleared) — never auto.
    // -----------------------------------------------------------------
    console.log("\n--- Part G: create an incoming check, then future -> deposited -> cleared ---");
    await page.goto(`${BASE_URL}/finance`, { waitUntil: "networkidle" });
    await page.click('button[role="tab"]:has-text("الشيكات")');
    await page.click('button:has-text("شيك وارد")');
    dialog = page.locator('[role="dialog"]');
    await dialog.locator('input[placeholder*="ابحث بالاسم"]').fill("أحمد يوسف");
    await page.waitForSelector('button:has-text("أحمد يوسف")', { timeout: 5000 });
    await page.locator('button:has-text("أحمد يوسف")').first().click();
    await dialog.locator("#incoming-amount").fill("1500");
    await dialog.locator("#incoming-due-date").fill(isoDateNDaysFromNow(5));
    await dialog.locator("#incoming-check-number").fill("00998877");
    await dialog.locator("#incoming-bank").fill("בנק דיסקונט / Bank Discount");
    await dialog.locator('button:has-text("إضافة الشيك")').click();
    await page.waitForSelector("text=تم تسجيل الشيك الوارد", { timeout: 10000 });
    await page.waitForTimeout(400);

    const { rows: newCheckRows } = await pool.query(
      `select id, status, customer_id, amount::text as amount from incoming_checks where check_number = '00998877'`,
    );
    const newCheck = newCheckRows[0];
    check(
      "new incoming check created for Ahmad, 1,500.00, status='future' (due in 5 days, > 3-day threshold) (DB)",
      newCheck?.customer_id === ahmadCustomerId && newCheck?.amount === "1500.00" && newCheck?.status === "future",
    );

    await page.reload({ waitUntil: "networkidle" });
    await page.click('button[role="tab"]:has-text("الشيكات")');
    let checkRow = page.locator("tr", { hasText: "00998877" });
    check("new check shows the 'مستقبلي' (future) badge in the UI", (await checkRow.filter({ hasText: "مستقبلي" }).count()) === 1);

    await checkRow.locator('[role="combobox"]').click();
    await page.locator('[role="option"]:has-text("تم الإيداع")').click();
    await page.waitForSelector("text=تم تحديث حالة الشيك", { timeout: 10000 });
    await page.waitForTimeout(400);
    let checkStatus = (await pool.query(`select status from incoming_checks where id = $1`, [newCheck.id])).rows[0].status;
    check("check explicitly moved future -> deposited (DB)", checkStatus === "deposited");

    await page.reload({ waitUntil: "networkidle" });
    await page.click('button[role="tab"]:has-text("الشيكات")');
    checkRow = page.locator("tr", { hasText: "00998877" });
    await checkRow.locator('[role="combobox"]').click();
    await page.locator('[role="option"]:has-text("تم التحصيل")').click();
    await page.waitForSelector("text=تم تحديث حالة الشيك", { timeout: 10000 });
    await page.waitForTimeout(400);
    checkStatus = (await pool.query(`select status from incoming_checks where id = $1`, [newCheck.id])).rows[0].status;
    check("check explicitly moved deposited -> cleared, and only that — never auto-transitioned on its own (DB)", checkStatus === "cleared");

    // -----------------------------------------------------------------
    // Part H: permission denial — a user lacking MANAGE_JOB_COSTS /
    // MANAGE_TECHNICIAN_PAYMENTS / APPROVE_REQUESTS cannot see the
    // relevant add/approve controls, even once granted enough VIEW_*
    // permission to see the section itself (Issam, temporarily granted
    // VIEW_JOB_COSTS + VIEW_TECHNICIAN_BALANCES only).
    // -----------------------------------------------------------------
    console.log("\n--- Part H: permission-denial DOM-absence checks (Issam, view-only) ---");
    await grantPermission(issamId, "view_job_costs");
    await grantPermission(issamId, "view_technician_balances");
    try {
      await employeeCtx.clearCookies();
      await login(page, "0503333333", "password123"); // Issam
      await page.goto(`${BASE_URL}${nabilHref}`, { waitUntil: "networkidle" }); // Issam is involved (measured Nabil's job)

      let costsCard2 = page.locator('[data-slot="card"]', { hasText: "التكاليف" });
      check("Issam (now has view_job_costs) CAN see the Costs section", (await costsCard2.count()) === 1);
      check("...but has no add-cost trigger (lacks manage_job_costs)", (await costsCard2.locator('button:has-text("إضافة تكلفة")').count()) === 0);
      check(
        "...and no approve/reject controls on the still-pending 350.00 hardware cost (lacks approve_requests)",
        (await costsCard2.locator('button:has-text("اعتماد")').count()) === 0 && (await costsCard2.locator('button:has-text("رفض")').count()) === 0,
      );

      let compCard = page.locator('[data-slot="card"]', { hasText: "تعويض الفنيين" });
      check("Issam (now has view_technician_balances) CAN see the Compensation section", (await compCard.count()) === 1);
      check(
        "...but has none of the manage-technician-payments controls",
        (await compCard.locator('button:has-text("تخصيص تعويض تركيب")').count()) === 0 &&
          (await compCard.locator('button:has-text("مكافأة")').count()) === 0 &&
          (await compCard.locator('button:has-text("غرامة")').count()) === 0,
      );

      await page.goto(`${BASE_URL}/finance/technicians/${baselId}`, { waitUntil: "networkidle" });
      check("Issam CAN view Basel's ledger page now (view_technician_balances)", (await page.locator("h1", { hasText: "باسل" }).count()) === 1);
      const seededRow = page.locator("li", { hasText: "200.00" });
      check(
        "...but sees no decide buttons on the still-pending -200.00 report (lacks manage_technician_payments)",
        (await seededRow.locator('button:has-text("اعتماد")').count()) === 0,
      );
      check("...and no self-report trigger (not his own page)", (await page.locator('button:has-text("الإبلاغ عن دفعة مستلمة")').count()) === 0);
      check("...and no manager quick-action dialogs (lacks manage_technician_payments)", (await page.locator('button:has-text("خصم استخدام مركبة")').count()) === 0);
    } finally {
      await revokePermission(issamId, "view_job_costs");
      await revokePermission(issamId, "view_technician_balances");
    }

    console.log("Permission-denial: MANAGE_CHECKS (Issam, natural permissions — no grant)...");
    await page.goto(`${BASE_URL}/finance`, { waitUntil: "networkidle" });
    await page.click('button[role="tab"]:has-text("الشيكات")');
    text = await page.innerText("body");
    check("Issam's checks tab still lists checks (view access, not gated)", text.includes("نبيل عودة"));
    check("...but has no 'شيك وارد' trigger (lacks manage_checks)", (await page.locator('button:has-text("شيك وارد")').count()) === 0);
    check("...and no 'شيك صادر' trigger (lacks manage_checks)", (await page.locator('button:has-text("شيك صادر")').count()) === 0);
    check("...and no status-update comboboxes anywhere on the checks tables", (await page.locator('table [role="combobox"]').count()) === 0);

    // -----------------------------------------------------------------
    // Part I: financial visibility — a user without VIEW_JOB_COSTS/
    // VIEW_PROFITABILITY sees no trace of the Costs section, and a user
    // without VIEW_TECHNICIAN_BALANCES only ever sees their OWN ledger.
    // -----------------------------------------------------------------
    console.log("\n--- Part I: financial visibility (Basel — lacks VIEW_JOB_COSTS/VIEW_PROFITABILITY/VIEW_TECHNICIAN_BALANCES) ---");
    await employeeCtx.clearCookies();
    await login(page, "0504444444", "password123"); // Basel
    await page.goto(`${BASE_URL}${ahmadHref}`, { waitUntil: "networkidle" }); // Basel is involved (measured + assigned)
    text = await page.innerText("body");
    check("Basel can open Ahmad's job (still involved)", text.includes("JOB-2026-0001"));
    check(
      "the Costs section is genuinely ABSENT for Basel — no heading, no figures (not merely hidden) (DOM)",
      (await page.locator('[data-slot="card"]', { hasText: "التكاليف" }).count()) === 0,
    );
    check(
      "the Compensation section is genuinely ABSENT for Basel too (lacks all three qualifying permissions) (DOM)",
      (await page.locator('[data-slot="card"]', { hasText: "تعويض الفنيين" }).count()) === 0,
    );

    await page.goto(`${BASE_URL}/finance/technicians`, { waitUntil: "networkidle" });
    check(
      "roster redirects a user without VIEW_TECHNICIAN_BALANCES straight to their OWN ledger, not the roster",
      new URL(page.url()).pathname === `/finance/technicians/${baselId}`,
    );

    await page.goto(`${BASE_URL}/finance/technicians/${issamId}`, { waitUntil: "networkidle" }); // someone else's page, direct navigation
    text = await page.innerText("body");
    check(
      "direct navigation to another technician's ledger shows Forbidden, not their data",
      text.includes("لا تملك صلاحية الوصول لهذه الصفحة") &&
        !text.includes("الرصيد المستحق") &&
        !text.includes("سجل الحركات"),
    );

    if (consoleErrors.length > 0) {
      console.log("\n--- Browser console errors seen during run ---");
      for (const e of consoleErrors) console.log("  ", e);
      failures++;
    }
  } catch (err) {
    console.error("VERIFICATION SCRIPT ERROR:", err);
    await page.screenshot({ path: "/tmp/phase8-error.png" }).catch(() => {});
    failures++;
  } finally {
    await pool.end();
    await browser.close();
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main();
