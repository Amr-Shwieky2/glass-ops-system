// Manual verification script for Phase 6 (Production / factory workflow) —
// not part of the automated test suite. Drives a real headless browser
// against the seeded demo data, plus a couple of direct DB reads to confirm
// the job_costs side effect of approval (nothing in the UI surfaces job
// costs yet — that's Phase 8/10). Finds jobs by their stable seeded numbers
// via the UI (never a hardcoded row id), same convention as
// verify-phase5.mjs, so it stays valid across a fresh `npm run db:seed`.
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

async function main() {
  // No executablePath override — that hardcoded Linux CI path doesn't
  // exist on every machine this script runs on (e.g. macOS). Let
  // Playwright resolve its own managed browser, same as
  // verify-phase7/8/9/10a.mjs.
  const browser = await chromium.launch();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const employeeCtx = await browser.newContext({ locale: "ar" });
  const page = await employeeCtx.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  let saraHref, nabilHref, ahmadHref, reemHref;
  let saraFactoryLink = null;
  let nabilFactoryLink = null;

  try {
    console.log("=== As Amr (full permissions) ===");
    await login(page, "0501111111", "password123");

    saraHref = await jobHrefByNumber(page, "JOB-2026-0002");
    nabilHref = await jobHrefByNumber(page, "JOB-2026-0005");
    ahmadHref = await jobHrefByNumber(page, "JOB-2026-0001");
    reemHref = await jobHrefByNumber(page, "JOB-2026-0004");

    // -----------------------------------------------------------------
    // Part A: Sara's job — minimal Phase 5 replay (just enough to reach
    // "waiting_for_production" with a real item), then the full fresh
    // Phase 6 flow: send -> factory submits -> we reject -> factory
    // resubmits -> we approve. Exercises the "normal forward advance"
    // case (waiting_for_production -> in_production -> ready_from_factory).
    // -----------------------------------------------------------------
    console.log("\n--- Part A: Sara (fresh quote -> factory flow, normal advance) ---");
    await page.goto(`${BASE_URL}${saraHref}`, { waitUntil: "networkidle" });
    let dialog = page.locator('[role="dialog"]');
    await page.click('button:has-text("إنشاء عرض سعر")');
    await dialog.locator('input[placeholder="الوصف"]').fill("زجاج شرفة");
    await dialog.locator('input[placeholder="الكمية"]').fill("1");
    await dialog.locator('input[placeholder="السعر"]').fill("1000");
    await dialog.locator('button:has-text("حفظ عرض السعر")').click();
    await page.waitForTimeout(700);

    await page.click('button:has-text("إرسال للعميل")');
    await page.waitForSelector("text=رابط توقيع العرض جاهز", { timeout: 10000 });
    const signingLink = await page.locator("input[readonly]").inputValue();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    const customerCtx = await browser.newContext({ locale: "ar" });
    const customerPage = await customerCtx.newPage();
    await customerPage.goto(signingLink, { waitUntil: "networkidle" });
    const canvas = customerPage.locator("canvas").first();
    await canvas.scrollIntoViewIfNeeded();
    const box = await canvas.boundingBox();
    await customerPage.mouse.move(box.x + 20, box.y + box.height / 2);
    await customerPage.mouse.down();
    await customerPage.mouse.move(box.x + box.width - 20, box.y + box.height / 2, { steps: 5 });
    await customerPage.mouse.up();
    await customerPage.check("#agreedToTerms");
    await customerPage.locator('button:has-text("توقيع والموافقة على العرض")').click();
    await customerPage.waitForSelector("text=تم توقيع عرض السعر", { timeout: 10000 });
    await customerCtx.close();

    await page.goto(`${BASE_URL}${saraHref}`, { waitUntil: "networkidle" });
    await page.click('button:has-text("تحويل العرض إلى مهمة")');
    await page.click('[role="alertdialog"] button:has-text("تحويل"):not(:has-text("العرض"))');
    await page.waitForTimeout(800);
    let text = await page.innerText("body");
    check("Sara's job converted, now waiting for production", text.includes("بانتظار الإنتاج"));
    check("production section shows empty state", text.includes("لم يُرسل هذا العمل إلى المصنع بعد"));

    console.log("1. Send Sara's job to the factory...");
    await page.click('button:has-text("إرسال إلى المصنع")');
    dialog = page.locator('[role="dialog"]');
    const prefill = await dialog.locator("#details").inputValue();
    check("details prefilled from job item", prefill.includes("زجاج شرفة"));
    await dialog.locator('button:has-text("إرسال إلى المصنع")').click();
    await page.waitForSelector("text=تم إنشاء طلب الإنتاج", { timeout: 10000 });
    saraFactoryLink = await dialog.locator("input[readonly]").inputValue();
    check("factory public link generated", /\/public\/pr\//.test(saraFactoryLink));
    await dialog.locator('button:has-text("تم")').click();
    await page.waitForTimeout(300);

    text = await page.innerText("body");
    check("job status advanced to in_production", text.includes("قيد الإنتاج"));
    check("production status shows pending", text.includes("بانتظار إرسال المصنع"));
    check("Send-to-factory button gone", !text.includes("إرسال إلى المصنع"));
    check("show-link button present", text.includes("رابط المصنع"));

    console.log("2. Factory visits the link and submits a price...");
    const factoryCtx = await browser.newContext({ locale: "ar" });
    const factoryPage = await factoryCtx.newPage();
    await factoryPage.goto(saraFactoryLink, { waitUntil: "networkidle" });
    text = await factoryPage.innerText("body");
    check("factory sees job number", text.includes("JOB-2026-0002"));
    check("factory sees request details", text.includes("زجاج شرفة"));
    await factoryPage.fill("#submittedPrice", "1500");
    await factoryPage.fill("#notes", "زجاج مقوى 8مم");
    await factoryPage.locator('button:has-text("إرسال السعر")').click();
    await factoryPage.waitForSelector("text=تم استلام عرضكم", { timeout: 10000 });
    text = await factoryPage.innerText("body");
    check("factory sees awaiting-review notice after submit", text.includes("تم استلام عرضكم"));
    check("no form shown while awaiting review", !text.includes("إرسال السعر"));

    console.log("3. Amr reviews the submitted price and REJECTS it...");
    await page.goto(`${BASE_URL}${saraHref}`, { waitUntil: "networkidle" });
    text = await page.innerText("body");
    check("status shows submitted/awaiting approval", text.includes("بانتظار اعتماد السعر"));
    check("submitted price shown (1,500)", /1,?500\.00|₪1,?500/.test(text));
    await page.click('button:has-text("رفض")');
    dialog = page.locator('[role="dialog"]');
    await dialog.locator("#rejectionReason").fill("السعر أعلى من المتوقع، يرجى المراجعة.");
    await dialog.locator('button:has-text("تأكيد الرفض")').click();
    await page.waitForTimeout(700);
    text = await page.innerText("body");
    check("rejected banner shown", text.includes("تم رفض هذا العرض"));
    check("rejection reason shown", text.includes("السعر أعلى من المتوقع"));
    // Substring note: the rejected banner's own prose ("تم رفض هذا العرض")
    // contains "رفض", and the "submitted" status badge contains "اعتماد
    // السعر" — so a plain body-text search for either phrase is unreliable
    // here. Count actual <button> elements instead.
    check(
      "decision buttons gone after rejection",
      (await page.locator('button:has-text("اعتماد السعر")').count()) === 0 &&
        (await page.locator('button:has-text("رفض")').count()) === 0,
    );
    check("job status NOT rolled back (still in_production)", text.includes("قيد الإنتاج"));

    console.log("4. /production filtered by 'rejected' shows Sara only...");
    await page.goto(`${BASE_URL}/production?status=rejected`, { waitUntil: "networkidle" });
    text = await page.innerText("body");
    check("rejected filter shows Sara's job", text.includes("JOB-2026-0002"));
    check("rejected filter excludes others", !text.includes("JOB-2026-0001") && !text.includes("JOB-2026-0004"));

    console.log("5. Factory sees the rejection and resubmits a new price...");
    await factoryPage.goto(saraFactoryLink, { waitUntil: "networkidle" });
    text = await factoryPage.innerText("body");
    check("factory sees rejection reason", text.includes("السعر أعلى من المتوقع"));
    check("form available again after rejection", text.includes("إرسال السعر"));
    await factoryPage.fill("#submittedPrice", "1200");
    await factoryPage.locator('button:has-text("إرسال السعر")').click();
    await factoryPage.waitForSelector("text=تم استلام عرضكم", { timeout: 10000 });
    await factoryCtx.close();

    console.log("6. Amr APPROVES the new price...");
    await page.goto(`${BASE_URL}${saraHref}`, { waitUntil: "networkidle" });
    text = await page.innerText("body");
    check("new submitted price shown (1,200)", /1,?200\.00|₪1,?200/.test(text));
    check("previous rejected attempt shown in history", text.includes("محاولات سابقة"));
    check("history footnote includes the rejected 1,500 price", /1,?500\.00|₪1,?500/.test(text));
    await page.click('button:has-text("اعتماد السعر")');
    const approveDialog = page.locator('[role="alertdialog"]');
    await approveDialog.locator('button:has-text("اعتماد"):not(:has-text("السعر"))').click();
    await page.waitForTimeout(700);
    text = await page.innerText("body");
    check("approved banner shown", text.includes("تم اعتماد هذا السعر"));
    check("job status advanced to ready_from_factory", text.includes("جاهز من المصنع"));
    check("production badge shows معتمد", text.includes("معتمد"));

    console.log("7. Factory revisits the link post-approval...");
    const factoryCtx2 = await browser.newContext({ locale: "ar" });
    const factoryPage2 = await factoryCtx2.newPage();
    await factoryPage2.goto(saraFactoryLink, { waitUntil: "networkidle" });
    text = await factoryPage2.innerText("body");
    check("factory sees approved notice", text.includes("تم اعتماد السعر"));
    await factoryCtx2.close();

    const saraCost = await pool.query(
      `select jc.amount, jc.status, jc.category from job_costs jc
       join jobs j on j.id = jc.job_id where j.job_number = 'JOB-2026-0002'`,
    );
    check(
      "job_costs row booked for Sara (1200.00, factory_glass, approved)",
      saraCost.rows.length === 1 &&
        saraCost.rows[0].amount === "1200.00" &&
        saraCost.rows[0].category === "factory_glass" &&
        saraCost.rows[0].status === "approved",
    );

    // -----------------------------------------------------------------
    // Part B: Nabil's job (already past production, status=repair_needed)
    // — regression check for the forward-only status guard, plus the
    // permission grant/denial check with two other users.
    // -----------------------------------------------------------------
    console.log("\n--- Part B: Nabil (forward-only guard + permissions) ---");
    await page.goto(`${BASE_URL}${nabilHref}`, { waitUntil: "networkidle" });
    text = await page.innerText("body");
    check("Nabil's job starts at repair_needed", text.includes("يحتاج إصلاح"));

    await page.click('button:has-text("إرسال إلى المصنع")');
    dialog = page.locator('[role="dialog"]');
    const nabilPrefill = await dialog.locator("#details").inputValue();
    check("Nabil prefill mentions both items", nabilPrefill.includes("مرآة") && nabilPrefill.includes("ألمنيوم"));
    await dialog.locator('button:has-text("إرسال إلى المصنع")').click();
    await page.waitForSelector("text=تم إنشاء طلب الإنتاج", { timeout: 10000 });
    nabilFactoryLink = await dialog.locator("input[readonly]").inputValue();
    await dialog.locator('button:has-text("تم")').click();
    await page.waitForTimeout(300);
    text = await page.innerText("body");
    check(
      "job status NOT moved to in_production (repair_needed sorts later)",
      text.includes("يحتاج إصلاح") && !text.includes("قيد الإنتاج"),
    );

    const nabilFactoryCtx = await browser.newContext({ locale: "ar" });
    const nabilFactoryPage = await nabilFactoryCtx.newPage();
    await nabilFactoryPage.goto(nabilFactoryLink, { waitUntil: "networkidle" });
    await nabilFactoryPage.fill("#submittedPrice", "800");
    await nabilFactoryPage.locator('button:has-text("إرسال السعر")').click();
    await nabilFactoryPage.waitForSelector("text=تم استلام عرضكم", { timeout: 10000 });
    await nabilFactoryCtx.close();

    console.log("8. Basel (no production permissions, but assigned) views read-only...");
    await employeeCtx.clearCookies();
    await login(page, "0504444444", "password123");
    await page.goto(`${BASE_URL}${nabilHref}`, { waitUntil: "networkidle" });
    text = await page.innerText("body");
    check("Basel can open Nabil's job (assigned)", text.includes("JOB-2026-0005"));
    check("Basel sees submitted status", text.includes("بانتظار اعتماد السعر"));
    // The "submitted" status badge itself contains the substring "اعتماد
    // السعر", so check actual <button> elements, not body text.
    check(
      "Basel has no decision/production buttons",
      (await page.locator('button:has-text("اعتماد السعر")').count()) === 0 &&
        (await page.locator('button:has-text("رفض")').count()) === 0 &&
        (await page.locator('button:has-text("رابط المصنع")').count()) === 0,
    );

    console.log("9. /production is forbidden for Basel...");
    await page.goto(`${BASE_URL}/production`, { waitUntil: "networkidle" });
    text = await page.innerText("body");
    check("Basel forbidden from /production", text.includes("لا تملك صلاحية الوصول لهذه الصفحة"));

    console.log("10. Mohammad (has approve_factory_price) approves Nabil's submission...");
    await employeeCtx.clearCookies();
    await login(page, "0502222222", "password123");
    await page.goto(`${BASE_URL}${nabilHref}`, { waitUntil: "networkidle" });
    check(
      "Mohammad sees decision buttons",
      (await page.locator('button:has-text("اعتماد السعر")').count()) === 1 &&
        (await page.locator('button:has-text("رفض")').count()) === 1,
    );
    await page.click('button:has-text("اعتماد السعر")');
    await page.waitForSelector('[role="alertdialog"]', { timeout: 10000 });
    await page
      .locator('[role="alertdialog"]')
      .locator('button:has-text("اعتماد"):not(:has-text("السعر"))')
      .click();
    await page.waitForTimeout(1200);
    text = await page.innerText("body");
    if (!text.includes("تم اعتماد هذا السعر")) {
      await page.screenshot({ path: "/tmp/nabil-approve-debug.png", fullPage: true }).catch(() => {});
      console.log("   (debug) approve-button count now:", await page.locator('button:has-text("اعتماد السعر")').count());
      console.log("   (debug) alertdialog still open:", await page.locator('[role="alertdialog"]').isVisible().catch(() => false));
    }
    check("Nabil's submission approved", text.includes("تم اعتماد هذا السعر"));
    check(
      "job status STILL not advanced past repair_needed (guard holds on approval too)",
      text.includes("يحتاج إصلاح") && !text.includes("جاهز من المصنع"),
    );

    const nabilCost = await pool.query(
      `select jc.amount, jc.status, jc.category from job_costs jc
       join jobs j on j.id = jc.job_id where j.job_number = 'JOB-2026-0005'`,
    );
    check(
      "job_costs row booked for Nabil (800.00, factory_glass, approved)",
      nabilCost.rows.length === 1 &&
        nabilCost.rows[0].amount === "800.00" &&
        nabilCost.rows[0].status === "approved",
    );

    // -----------------------------------------------------------------
    // Part C: pre-seeded historical rows (Ahmad, Reem) + the queue page.
    // -----------------------------------------------------------------
    console.log("\n--- Part C: pre-seeded rows + /production queue ---");
    await employeeCtx.clearCookies();
    await login(page, "0501111111", "password123");

    await page.goto(`${BASE_URL}${ahmadHref}`, { waitUntil: "networkidle" });
    text = await page.innerText("body");
    check("Ahmad's pre-seeded request shows معتمد", text.includes("معتمد"));
    check("Ahmad's price shown (3,200)", /3,?200\.00|₪3,?200/.test(text));
    check("no factory-link button for historical row (no link was seeded)", !text.includes("رابط المصنع"));

    await page.goto(`${BASE_URL}${reemHref}`, { waitUntil: "networkidle" });
    text = await page.innerText("body");
    check("Reem's pre-seeded request shows معتمد", text.includes("معتمد"));
    check("Reem's price shown (2,100)", /2,?100\.00|₪2,?100/.test(text));

    await page.goto(`${BASE_URL}/production`, { waitUntil: "networkidle" });
    text = await page.innerText("body");
    check(
      "queue lists all 4 sent jobs",
      ["JOB-2026-0001", "JOB-2026-0002", "JOB-2026-0004", "JOB-2026-0005"].every((n) =>
        text.includes(n),
      ),
    );
    check("queue excludes Khaled (never sent)", !text.includes("JOB-2026-0003"));

    await page.goto(`${BASE_URL}/production?q=${encodeURIComponent("ريم")}`, { waitUntil: "networkidle" });
    text = await page.innerText("body");
    check("search by customer name narrows to Reem", text.includes("JOB-2026-0004") && !text.includes("JOB-2026-0001"));

    if (consoleErrors.length > 0) {
      console.log("\n--- Browser console errors seen during run ---");
      for (const e of consoleErrors) console.log("  ", e);
      failures++;
    }
  } catch (err) {
    console.error("VERIFICATION SCRIPT ERROR:", err);
    await page.screenshot({ path: "/tmp/phase6-error.png" }).catch(() => {});
    failures++;
  } finally {
    await pool.end();
    await browser.close();
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main();
