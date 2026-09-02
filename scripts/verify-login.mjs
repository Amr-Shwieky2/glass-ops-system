// One-off manual verification script (not part of the automated test suite).
// Drives a real headless browser through: unauthenticated redirect -> login
// with a seeded demo account -> dashboard render with real DB-backed stats.
import { chromium } from "playwright-core";

const BASE_URL = "http://localhost:3000";

async function main() {
  // No executablePath override — that hardcoded Linux CI path doesn't
  // exist on every machine this script runs on (e.g. macOS). Let
  // Playwright resolve its own managed browser, same as
  // verify-phase6/7/8/9/10a.mjs.
  const browser = await chromium.launch();
  const page = await browser.newPage({ locale: "ar" });
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  try {
    console.log("1. Visiting / while unauthenticated...");
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    const urlAfterRoot = page.url();
    console.log("   -> ended up at:", urlAfterRoot);
    if (!urlAfterRoot.includes("/login")) {
      throw new Error("Expected redirect to /login, got " + urlAfterRoot);
    }

    const html = await page.content();
    if (!html.includes('dir="rtl"')) {
      throw new Error("Expected dir=rtl on the login page");
    }
    console.log("   OK: redirected to /login, dir=rtl confirmed");

    console.log("2. Filling in login form for Amr (+972501111111)...");
    await page.fill("#phone", "0501111111");
    await page.fill("#password", "password123");
    await page.screenshot({ path: "/tmp/1-login-filled.png" });

    await Promise.all([
      page.waitForURL("**/dashboard", { timeout: 10000 }),
      page.click('button[type="submit"]'),
    ]);
    console.log("   OK: navigated to", page.url());

    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: "/tmp/2-dashboard.png", fullPage: true });

    const dashboardText = await page.innerText("body");
    console.log("3. Checking dashboard content...");
    const checks = [
      ["مرحباً، عمرو", dashboardText.includes("مرحباً")],
      ["nav item العملاء present", dashboardText.includes("العملاء")],
      ["customer count 5", /\b5\b/.test(dashboardText)],
      [
        "ready-without-install widget title",
        dashboardText.includes("جاهزة من المصنع"),
      ],
      ["job JOB-2026-0004 listed (Reem, ready_from_factory, no install appt)", dashboardText.includes("JOB-2026-0004")],
    ];
    for (const [label, ok] of checks) {
      console.log(`   ${ok ? "OK" : "FAIL"}: ${label}`);
      if (!ok) process.exitCode = 1;
    }

    console.log("4. Testing logout...");
    await page.click('button[aria-label="تسجيل الخروج"]');
    await page.waitForURL("**/login", { timeout: 10000 });
    console.log("   OK: logged out, back at", page.url());

    console.log("5. Testing wrong password rejection...");
    await page.fill("#phone", "0501111111");
    await page.fill("#password", "wrong-password");
    await page.click('button[type="submit"]');
    // Scoped to <p role="alert"> specifically: Next.js also keeps a hidden,
    // always-present route-announcer div with role="alert" in the DOM for
    // screen readers, which a bare [role="alert"] selector would match too.
    await page.waitForSelector('p[role="alert"]', { timeout: 10000 });
    const errorText = await page.innerText('p[role="alert"]');
    console.log("   OK: error shown ->", errorText);
    const phoneRetained = await page.inputValue("#phone");
    console.log(
      `   ${phoneRetained === "0501111111" ? "OK" : "FAIL"}: phone field retained after error (got "${phoneRetained}")`,
    );

    console.log("6. Testing mobile viewport nav drawer...");
    await page.fill("#phone", "0501111111");
    await page.fill("#password", "password123");
    await Promise.all([
      page.waitForURL("**/dashboard", { timeout: 10000 }),
      page.click('button[type="submit"]'),
    ]);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    await page.click('button[aria-label="فتح القائمة"]');
    await page.waitForTimeout(300);
    await page.screenshot({ path: "/tmp/3-mobile-drawer.png" });
    const drawerVisible = await page.isVisible("text=إدارة عمليات الزجاج");
    console.log(`   ${drawerVisible ? "OK" : "FAIL"}: mobile drawer opened`);

    if (consoleErrors.length > 0) {
      console.log("\n--- Browser console errors seen during run ---");
      for (const e of consoleErrors) console.log("  ", e);
      process.exitCode = 1;
    } else {
      console.log("\nNo browser console errors.");
    }
  } catch (err) {
    console.error("VERIFICATION FAILED:", err);
    await page.screenshot({ path: "/tmp/error-state.png" }).catch(() => {});
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main();
