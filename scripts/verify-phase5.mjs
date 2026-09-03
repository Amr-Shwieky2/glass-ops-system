// Manual verification script for Phase 5 (Quotes, e-signature, PDF,
// convert-to-job) — not part of the automated test suite. Drives a real
// headless browser against the seeded demo data. Finds jobs/quotes by their
// stable seeded numbers via the UI (never a hardcoded row id), so it stays
// valid across a fresh `npm run db:seed` (which reuses the same job/quote
// numbers but assigns brand new random ids).
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

async function jobHrefByNumber(page, jobNumber) {
  await page.goto(`${BASE_URL}/jobs`, { waitUntil: "networkidle" });
  return page.locator(`a:has-text("${jobNumber}")`).first().getAttribute("href");
}

/** Draws a couple of strokes on the signature <canvas> so it's non-empty.
 * Must scroll it into view first: page.mouse.* dispatches at raw viewport
 * coordinates (unlike locator.click(), it does not auto-scroll), and the
 * signing form is long enough that the pad starts below the fold. */
async function drawSignature(page) {
  const canvas = page.locator("canvas").first();
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + 20, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.3, { steps: 5 });
  await page.mouse.move(box.x + box.width - 20, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
}

async function main() {
  // No executablePath override — that hardcoded Linux CI path doesn't
  // exist on every machine this script runs on (e.g. macOS). Let
  // Playwright resolve its own managed browser, same as
  // verify-phase6/7/8/9/10a.mjs.
  const browser = await chromium.launch();
  const employeeCtx = await browser.newContext({ locale: "ar" });
  const page = await employeeCtx.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  let signingLink = null;
  let ahmadPdfHref = null;
  let khaledPdfHref = null;

  try {
    console.log("=== As Amr (full permissions) ===");
    await login(page, "0501111111", "password123");

    const saraHref = await jobHrefByNumber(page, "JOB-2026-0002");
    const ahmadHref = await jobHrefByNumber(page, "JOB-2026-0001");
    const khaledHref = await jobHrefByNumber(page, "JOB-2026-0003");

    console.log("1. Sara's job has no quote yet -> Create Quote flow...");
    await page.goto(`${BASE_URL}${saraHref}`, { waitUntil: "networkidle" });
    let text = await page.innerText("body");
    check("shows empty quote state", text.includes("لم يُنشأ أي عرض سعر بعد"));

    let dialog = page.locator('[role="dialog"]');
    await page.click('button:has-text("إنشاء عرض سعر")');
    await dialog.locator('input[placeholder="الوصف"]').fill("زجاج واجهة تجريبي");
    await dialog.locator('input[placeholder="الكمية"]').fill("2");
    await dialog.locator('input[placeholder="السعر"]').fill("450");
    await dialog.locator('button:has-text("حفظ عرض السعر")').click();
    await page.waitForTimeout(700);
    text = await page.innerText("body");
    check("quote created, shows draft badge", text.includes("مسودة"));
    check("shows correct total (900)", /900\.00|₪900/.test(text));

    console.log("2. Edit the draft, add a second item...");
    await page.click('button:has-text("متابعة تحرير المسودة")');
    dialog = page.locator('[role="dialog"]');
    await dialog.locator('button:has-text("إضافة بند")').click();
    const descInputs = dialog.locator('input[placeholder="الوصف"]');
    await descInputs.nth(1).fill("مرآة مدخل");
    const qtyInputs = dialog.locator('input[placeholder="الكمية"]');
    await qtyInputs.nth(1).fill("1");
    const priceInputs = dialog.locator('input[placeholder="السعر"]');
    await priceInputs.nth(1).fill("300");
    await dialog.locator('button:has-text("حفظ عرض السعر")').click();
    await page.waitForTimeout(700);
    text = await page.innerText("body");
    check("second item saved", text.includes("مرآة مدخل"));
    check("total updated to 1200", /1,?200\.00|₪1,?200/.test(text));
    check(
      "editing a draft bumped it to version 2 (every save is a new immutable version)",
      text.includes("الإصدار 2"),
    );

    console.log("3. Send the quote to the customer...");
    await page.click('button:has-text("إرسال للعميل")');
    await page.waitForSelector("text=رابط توقيع العرض جاهز", { timeout: 10000 });
    const linkInput = page.locator("input[readonly]");
    signingLink = await linkInput.inputValue();
    check("public signing link generated", /\/public\/q\//.test(signingLink));
    check("WhatsApp share button shown", (await page.innerText("body")).includes("واتساب"));
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    text = await page.innerText("body");
    check("status now 'sent'", text.includes("بانتظار توقيع العميل"));

    console.log("4. Invalid token shows a friendly error, not a crash...");
    await page.goto(`${BASE_URL}/public/q/not-a-real-token`, { waitUntil: "networkidle" });
    text = await page.innerText("body");
    check("invalid link message shown", text.includes("الرابط غير صالح"));

    console.log("=== Customer signing (separate, unauthenticated context) ===");
    const customerCtx = await browser.newContext({ locale: "ar" });
    const customerPage = await customerCtx.newPage();
    await customerPage.goto(signingLink, { waitUntil: "networkidle" });
    text = await customerPage.innerText("body");
    check("customer sees quote total", /1,?200\.00|₪1,?200/.test(text));
    check("customer sees sign form", text.includes("التوقيع والموافقة"));

    await drawSignature(customerPage);
    await customerPage.check("#agreedToTerms");
    const submitBtn = customerPage.locator('button:has-text("توقيع والموافقة على العرض")');
    check("submit enabled once signed+agreed", await submitBtn.isEnabled());
    await submitBtn.click();
    await customerPage.waitForSelector("text=تم توقيع عرض السعر", { timeout: 10000 });
    text = await customerPage.innerText("body");
    check("confirmation shown after signing", text.includes("تم توقيع عرض السعر"));
    await customerCtx.close();

    console.log("5. Re-visiting the same link shows the signed view, not the form...");
    const replayCtx = await browser.newContext({ locale: "ar" });
    const replayPage = await replayCtx.newPage();
    await replayPage.goto(signingLink, { waitUntil: "networkidle" });
    text = await replayPage.innerText("body");
    check(
      "already-signed view shown, sign form gone",
      text.includes("تم توقيع عرض السعر") && !text.includes("التوقيع والموافقة"),
    );
    await replayCtx.close();

    console.log(
      "6. Back as Amr: the customer's own signature already auto-converted + auto-sent to factory (no manual click) ...",
    );
    await page.goto(`${BASE_URL}${saraHref}`, { waitUntil: "networkidle" });
    text = await page.innerText("body");
    check("quote status shows موقّع", text.includes("موقّع"));
    check("signed banner shown", text.includes("تم توقيع هذا العرض من العميل"));
    check(
      "no Convert-to-job button (auto-conversion already ran on signing)",
      !text.includes("تحويل العرض إلى مهمة"),
    );
    check("job items already reflect the quote (واجهة)", text.includes("زجاج واجهة تجريبي"));
    check("job items include the mirror line", text.includes("مرآة مدخل"));
    check("job sale total shows 1200", /1,?200\.00|₪1,?200/.test(text));
    check(
      "no manual send-to-factory button (auto-sent to factory already ran)",
      !text.includes("إرسال إلى المصنع"),
    );
    check(
      "job status auto-advanced straight to in_production",
      text.includes("قيد الإنتاج"),
    );
    check(
      "auto-created production request details mention the quote's items",
      text.includes("زجاج واجهة تجريبي"),
    );

    console.log("=== PDF generation ===");
    await page.goto(`${BASE_URL}${ahmadHref}`, { waitUntil: "networkidle" });
    ahmadPdfHref = await page.locator('a:has-text("عرض PDF")').getAttribute("href");
    const pdfResp = await page.request.get(`${BASE_URL}${ahmadPdfHref}`);
    check("Ahmad's (signed) PDF returns 200", pdfResp.status() === 200);
    check(
      "PDF content-type correct",
      (pdfResp.headers()["content-type"] || "").includes("application/pdf"),
    );
    const pdfBuf = await pdfResp.body();
    check("PDF body non-trivial size", pdfBuf.length > 5000);
    check("PDF starts with %PDF magic bytes", pdfBuf.slice(0, 4).toString("latin1") === "%PDF");

    console.log("=== Ahmad's job: already signed + already converted ===");
    text = await page.innerText("body");
    check("Ahmad quote shows موقّع", text.includes("موقّع"));
    check("no Convert button (already converted)", !text.includes("تحويل العرض إلى مهمة"));

    console.log("=== Khaled's job: pre-seeded, sent-but-unsigned quote ===");
    await page.goto(`${BASE_URL}${khaledHref}`, { waitUntil: "networkidle" });
    khaledPdfHref = await page.locator('a:has-text("عرض PDF")').getAttribute("href");
    text = await page.innerText("body");
    check("Khaled's quote shows بانتظار توقيع العميل", text.includes("بانتظار توقيع العميل"));

    console.log("\n=== As Basel (no create_quote/send_quote/close_deal) ===");
    await employeeCtx.clearCookies();
    await login(page, "0504444444", "password123");

    console.log("8. Basel sees Ahmad's (his) job quote read-only...");
    await page.goto(`${BASE_URL}${ahmadHref}`, { waitUntil: "networkidle" });
    text = await page.innerText("body");
    check("Basel sees the quote content", text.includes("موقّع"));
    check(
      "Basel has no edit/send/convert buttons",
      !text.includes("تعديل") &&
        !text.includes("إرسال للعميل") &&
        !text.includes("تحويل العرض إلى مهمة"),
    );

    console.log("9. Basel is forbidden from Khaled's quote PDF (uninvolved job)...");
    const forbiddenResp = await page.request.get(`${BASE_URL}${khaledPdfHref}`);
    check("403 for uninvolved job's quote PDF", forbiddenResp.status() === 403);

    console.log("10. Basel CAN fetch Ahmad's quote PDF (he's involved)...");
    const allowedResp = await page.request.get(`${BASE_URL}${ahmadPdfHref}`);
    check("200 for involved job's quote PDF", allowedResp.status() === 200);

    if (consoleErrors.length > 0) {
      console.log("\n--- Browser console errors seen during run ---");
      for (const e of consoleErrors) console.log("  ", e);
      failures++;
    }
  } catch (err) {
    console.error("VERIFICATION SCRIPT ERROR:", err);
    await page.screenshot({ path: "/tmp/phase5-error.png" }).catch(() => {});
    failures++;
  } finally {
    await browser.close();
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main();
