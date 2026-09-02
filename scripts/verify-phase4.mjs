// Manual verification script for Phase 4 (Customers, Jobs, Measurements,
// Job Items, Assignments, global search) — not part of the automated
// test suite. Drives a real headless browser against the seeded demo data.
import { chromium } from "playwright-core";

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

async function main() {
  // No executablePath override — that hardcoded Linux CI path doesn't
  // exist on every machine this script runs on (e.g. macOS). Let
  // Playwright resolve its own managed browser, same as
  // verify-phase6/7/8/9/10a.mjs.
  const browser = await chromium.launch();
  const context = await browser.newContext({ locale: "ar" });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  try {
    console.log("=== As Amr (full permissions) ===");
    await login(page, "0501111111", "password123");

    console.log("1. Customers list...");
    await page.goto(`${BASE_URL}/customers`, { waitUntil: "networkidle" });
    let text = await page.innerText("body");
    check("shows 5 customers count", text.includes("5 عملاء") || /\b5\b/.test(text));
    check("Ahmad Yousef listed", text.includes("أحمد يوسف"));
    check("Add-customer button visible", text.includes("عميل جديد"));

    console.log("2. Customer search...");
    await page.fill('input[name="q"]', "أحمد");
    await page.click('button:has-text("بحث")');
    await page.waitForLoadState("networkidle");
    text = await page.innerText("body");
    check("search narrows to Ahmad", text.includes("أحمد يوسف") && !text.includes("سارة حداد"));

    console.log("3. Customer detail (Ahmad) shows job history...");
    await Promise.all([
      page.waitForURL(/\/customers\/[0-9a-f-]+$/, { timeout: 10000 }),
      page.click("text=أحمد يوسف"),
    ]);
    await page.waitForLoadState("networkidle");
    text = await page.innerText("body");
    check("shows JOB-2026-0001", text.includes("JOB-2026-0001"));
    check("shows completed status badge", text.includes("مكتمل"));

    console.log("4. Create a new customer...");
    await page.goto(`${BASE_URL}/customers`, { waitUntil: "networkidle" });
    await page.click('button:has-text("عميل جديد")');
    await page.fill("#name", "زبون تجريبي");
    await page.fill("#phone", "0509998887");
    await page.click('button:has-text("إضافة العميل")');
    await page.waitForTimeout(800);
    text = await page.innerText("body");
    check("new customer appears in list", text.includes("زبون تجريبي"));

    // The seed grew from 5 to 8 demo jobs across later phases (Job 6 Mona,
    // Job 7 Karim, Job 8 Yasmin — see src/server/db/seed.ts) after this
    // script was first written; check against all 8 so it stays accurate
    // as the seed evolves, same reconciliation this file's own comments
    // elsewhere describe for other phase scripts.
    console.log("5. Jobs list shows all 8 seeded jobs...");
    await page.goto(`${BASE_URL}/jobs`, { waitUntil: "networkidle" });
    text = await page.innerText("body");
    for (const num of [
      "JOB-2026-0001",
      "JOB-2026-0002",
      "JOB-2026-0003",
      "JOB-2026-0004",
      "JOB-2026-0005",
      "JOB-2026-0006",
      "JOB-2026-0007",
      "JOB-2026-0008",
    ]) {
      check(`${num} listed`, text.includes(num));
    }

    console.log("6. Create a new job for the test customer...");
    await page.goto(`${BASE_URL}/jobs/new`, { waitUntil: "networkidle" });
    await page.fill('input[placeholder*="ابحث بالاسم"]', "زبون تجريبي");
    await page.waitForTimeout(600);
    const firstResult = page.locator("button:has-text('زبون تجريبي')").first();
    await firstResult.click();
    await page.fill("#title", "اختبار مهمة جديدة");
    await Promise.all([
      page.waitForURL(/\/jobs\/[0-9a-f-]+$/, { timeout: 10000 }),
      page.click('button:has-text("إنشاء المهمة")'),
    ]);
    text = await page.innerText("body");
    // Job numbering continues on from the 8 seeded jobs (see the "5."
    // check above), so the next created job is JOB-2026-0009.
    check("new job detail page shows JOB-2026-0009", text.includes("JOB-2026-0009"));
    check("shows new_lead status", text.includes("عميل محتمل جديد"));

    console.log("7. Add a measurement, job item, and assignment to the new job...");
    await page.click('button:has-text("إضافة قياس")');
    await page.fill("#details", "قياس تجريبي 100x200 سم");
    await page.click('button:has-text("حفظ القياس")');
    await page.waitForTimeout(600);
    text = await page.innerText("body");
    check("measurement recorded and status advanced", text.includes("قياس تجريبي") && text.includes("تم القياس"));

    await page.click('button:has-text("إضافة بند")');
    await page.fill("#description", "زجاج تجريبي");
    await page.fill("#quantity", "2");
    await page.fill("#salePrice", "500");
    await page.click('button:has-text("إضافة البند")');
    await page.waitForTimeout(600);
    text = await page.innerText("body");
    check("job item added", text.includes("زجاج تجريبي"));

    await page.click('button:has-text("تعيين فني")');
    await page.click("#userId");
    // Scoped to the visible Radix listbox option, not the hidden native
    // <option> Radix's form-integration BubbleSelect also renders (which
    // a bare text= selector matches first, since it's earlier in the DOM).
    await page.click('[role="option"]:has-text("محمد")');
    await page.click('button:has-text("تعيين"):not(:has-text("فني"))');
    await page.waitForTimeout(600);
    text = await page.innerText("body");
    check("technician assigned", text.includes("محمد"));

    console.log("8. Status filter on jobs list...");
    await page.goto(`${BASE_URL}/jobs`, { waitUntil: "networkidle" });
    await page.click('button[role="combobox"]:has-text("كل الحالات")');
    await page.click('[role="option"]:has-text("جاهز من المصنع")');
    await page.waitForURL(/status=ready_from_factory/, { timeout: 5000 });
    await page.waitForLoadState("networkidle");
    text = await page.innerText("body");
    // JOB-2026-0004 (Reem) has since moved on to installation_scheduled
    // (Phase 7's seeded appointments); JOB-2026-0006 (Mona) is the seeded
    // job that now sits in ready_from_factory (see src/server/db/seed.ts).
    check(
      "filter shows only JOB-2026-0006",
      text.includes("JOB-2026-0006") && !text.includes("JOB-2026-0001") && !text.includes("JOB-2026-0004"),
    );

    console.log("9. Global search...");
    await page.goto(`${BASE_URL}/dashboard`, { waitUntil: "networkidle" });
    await page.fill('input[placeholder*="بحث شامل"]', "خالد");
    await page.keyboard.press("Enter");
    await page.waitForURL(/\/search\?q=/, { timeout: 10000 });
    await page.waitForLoadState("networkidle");
    text = await page.innerText("body");
    check("global search finds Khaled Mansour", text.includes("خالد منصور"));
    check("global search finds his job JOB-2026-0003", text.includes("JOB-2026-0003"));

    console.log("\n=== As Basel (restricted: VIEW_ASSIGNED_JOBS only, no CREATE_CUSTOMER/ASSIGN_INSTALLER) ===");
    // Ground truth from the seed data (checked directly against the DB):
    // Basel measured JOB-2026-0001 and JOB-2026-0002 and is assigned to
    // JOB-2026-0001/0005 — so he's legitimately "involved" in those. He has
    // no connection at all to JOB-2026-0003 (Khaled) — grab its URL now,
    // while still logged in as Amr, to test against after switching users.
    await page.goto(`${BASE_URL}/jobs`, { waitUntil: "networkidle" });
    const job3Href = await page
      .locator('a:has-text("JOB-2026-0003")')
      .first()
      .getAttribute("href");

    // Must actually log out first: proxy.ts correctly bounces an already-
    // authenticated visitor away from /login, so simply navigating there
    // as Amr would just land back on /dashboard, not the login form.
    await context.clearCookies();
    await login(page, "0504444444", "password123");

    console.log("10. Basel sees customers but no add-customer button...");
    await page.goto(`${BASE_URL}/customers`, { waitUntil: "networkidle" });
    text = await page.innerText("body");
    check("Basel can view customer list", text.includes("أحمد يوسف"));
    check("Basel has NO add-customer button", !text.includes("عميل جديد"));

    console.log("11. Basel's job list is restricted to jobs he's involved in...");
    await page.goto(`${BASE_URL}/jobs`, { waitUntil: "networkidle" });
    text = await page.innerText("body");
    check("Basel sees JOB-2026-0001 (he measured + was assigned)", text.includes("JOB-2026-0001"));
    check("Basel sees JOB-2026-0002 (he also measured it)", text.includes("JOB-2026-0002"));
    check("Basel does NOT see JOB-2026-0003 (uninvolved)", !text.includes("JOB-2026-0003"));
    check("restricted-view note shown", text.includes("المهام التي لك علاقة بها"));

    console.log("12. Basel is forbidden from opening a job he's not involved in...");
    await page.goto(`${BASE_URL}${job3Href}`, { waitUntil: "networkidle" });
    text = await page.innerText("body");
    check("Forbidden message shown for uninvolved job", text.includes("لا تملك صلاحية الوصول"));
    check("job details NOT leaked", !text.includes("خالد منصور"));

    if (consoleErrors.length > 0) {
      console.log("\n--- Browser console errors seen during run ---");
      for (const e of consoleErrors) console.log("  ", e);
      failures++;
    }
  } catch (err) {
    console.error("VERIFICATION SCRIPT ERROR:", err);
    await page.screenshot({ path: "/tmp/phase4-error.png" }).catch(() => {});
    failures++;
  } finally {
    await browser.close();
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main();
