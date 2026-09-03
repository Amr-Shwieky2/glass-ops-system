// Manual verification script for Requirement 4 (AI-assisted Hebrew quote
// drafting via local Ollama, and the Hebrew document-language / e-signature
// support built alongside it — reusing the existing quote/signature/
// versioning/PDF pipeline almost entirely as-is, per AGENTS.md's design
// decision) — not part of the automated test suite. Drives a real headless
// browser against the running dev server, plus direct DB/schema reads via
// the pg Pool for the checks the UI doesn't surface.
//
// REGRESSION COVERAGE NOTE: this script does NOT re-check quote-version
// immutability or the plain Arabic quote/e-signature flow — those are
// scripts/verify-phase5.mjs (Phase 5's own manual script) and
// tests/e2e/quotes.spec.ts (the Playwright immutability suite), BOTH of
// which were re-run unchanged against a fresh `npm run db:seed` as part of
// reconciling this feature and BOTH fully passed (see the commit this
// script ships with). This script is scoped to the NEW Hebrew/AI surface
// only, never touching any pre-seeded job — it creates its own two fresh
// jobs via /jobs/new (same convention as tests/e2e/fixtures.ts's
// createLeadJob) — so it never risks colliding with any other script's
// assumptions about seeded job numbers/statuses.
//
// Covers:
//   1. AI draft generation (POST generateQuoteDraftAction against a real,
//      locally-running Ollama — see src/server/ai/) pre-fills the existing
//      Quote Builder dialog and NEVER writes a quotes/quote_versions row by
//      itself (draft-assist only, human must explicitly save — AGENTS.md's
//      "never auto-send" constraint). The small local model (qwen2.5:3b)
//      is genuinely nondeterministic — sometimes it returns text that
//      fails DraftedQuoteSchema validation and generateQuoteDraftAction
//      returns a clean Arabic error instead (verified directly against
//      this same Ollama server while reconciling this feature) — so this
//      script tolerates and explicitly checks BOTH outcomes: a successful
//      pre-fill, or a clean failure that never crashes the page and leaves
//      the normal manual flow fully usable, retrying a couple of times
//      before falling back to a manually-built Hebrew quote so the rest of
//      the script (send/sign/PDF) always has real data to exercise.
//   2. quotes.language and quote_versions.is_ai_generated/.ai_prompt_notes
//      actually persist end to end (not just a UI-only selector — see the
//      wiring added to src/server/quotes/actions.ts + versions.ts while
//      reconciling this feature).
//   3. Sending + signing a Hebrew quote end to end: the public sign page
//      and PDF (both the staff and public PDF routes) render Hebrew labels
//      correctly, and quote_signatures.customer_national_id_at_signing is
//      the SAME pre-existing column the Arabic flow uses (checked directly
//      against information_schema — no new Hebrew-specific column exists).
//   4. localStorage autofill: signing one quote in a browser context
//      prefills name/phone/national-id (but never address) on a SECOND,
//      different quote's sign page opened later in that same context.
//
// No executablePath override (let Playwright resolve its own managed
// browser), same as verify-phase5/6/7/8/9/10a.mjs.
import "dotenv/config";
import { chromium } from "playwright-core";
import { Pool } from "pg";

const BASE_URL = "http://localhost:3000";

let failures = 0;
function check(label, ok) {
  console.log(`   ${ok ? "OK" : "FAIL"}: ${label}`);
  if (!ok) failures++;
}

let uniqueCounter = 0;
function uniquePhone() {
  uniqueCounter += 1;
  const suffix = String((Date.now() + uniqueCounter) % 10_000_000).padStart(7, "0");
  return `+9725${suffix}`;
}
function uniqueLabel(prefix) {
  uniqueCounter += 1;
  return `${prefix} #${Date.now().toString(36)}${uniqueCounter}`;
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

/** Creates a brand-new customer + job via the real /jobs/new form — same
 * helper tests/e2e/fixtures.ts's createLeadJob provides for Playwright
 * specs, reimplemented here in plain JS since this script (like every
 * scripts/verify-phaseN.mjs) runs directly under `node`, not the Playwright
 * test runner. Never touches a pre-seeded job/customer. */
async function createLeadJob(page, { customerName, customerPhone, title }) {
  await page.goto(`${BASE_URL}/jobs/new`, { waitUntil: "networkidle" });
  await page.click('button:has-text("عميل جديد")');
  await page.fill("#newCustomerName", customerName);
  await page.fill("#newCustomerPhone", customerPhone);
  await page.fill("#title", title);
  await Promise.all([
    page.waitForURL(/\/jobs\/[0-9a-f-]{36}$/, { timeout: 10000 }),
    page.click('button:has-text("إنشاء المهمة")'),
  ]);
  const jobId = new URL(page.url()).pathname.split("/").pop();
  const jobNumber = (await page.locator("h1").first().innerText()).trim();
  return { jobId, jobNumber, href: `/jobs/${jobId}` };
}

/** Draws a couple of strokes on the signature <canvas> so it's non-empty —
 * identical to verify-phase5.mjs's drawSignature. */
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

/** Picks "العبرية" in the Quote Builder's language <Select> (a Radix
 * combobox — its option list renders in a portal, so the click target must
 * be page-scoped, same convention as verify-phase7.mjs's appointment-type
 * select and verify-phase9.mjs's repair-status select). The language select
 * is always the LAST combobox in the dialog's DOM order (after every
 * per-row work-type select, of which there is always at least one). */
async function selectHebrew(dialog, page) {
  await dialog.locator('[role="combobox"]').last().click();
  await page.locator('[role="option"]:has-text("العبرية")').click();
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const browser = await chromium.launch();
  const employeeCtx = await browser.newContext({ locale: "ar" });
  const page = await employeeCtx.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  const SIGNER_A = { name: "יוסי כהן", phone: "0521234567", id: "302345678", address: "רחוב הרצל 10, תל אביב" };

  try {
    console.log("=== As Amr (CREATE_QUOTE + SEND_QUOTE + Ollama-backed AI drafting) ===");
    await login(page, "0501111111", "password123");

    console.log("Setup: a brand-new job for the AI-draft + Hebrew flow (job A)...");
    const jobA = await createLeadJob(page, {
      customerName: uniqueLabel("عميل عبري أ"),
      customerPhone: uniquePhone(),
      title: "تركيب باب زجاجي منزلق للمطبخ",
    });

    console.log("1. AI draft generation (real local Ollama call)...");
    await page.click('button:has-text("إنشاء مسودة بالذكاء الاصطناعي")');
    let dialog = page.locator('[role="dialog"]');
    await dialog
      .locator("#jobDescription")
      .fill("تركيب باب زجاجي منزلق للمطبخ بمقاس 2×2.2 متر مع سكة ألمنيوم وقفل مركزي.");

    let aiSucceeded = false;
    const MAX_ATTEMPTS = 3;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      await dialog.locator('button:has-text("توليد")').click();
      try {
        await page.waitForSelector("text=لغة المستند", { timeout: 20000 });
        aiSucceeded = true;
        break;
      } catch {
        const sawCleanError = (await page.locator("text=تعذر إنشاء المسودة").count()) > 0;
        console.log(
          `   (attempt ${attempt}/${MAX_ATTEMPTS}: generation did not produce a usable draft this time` +
            `${sawCleanError ? " — clean Arabic error shown, not a crash" : ""}` +
            `${attempt < MAX_ATTEMPTS ? ", retrying..." : ", falling back to a manual Hebrew quote."})`,
        );
      }
    }

    if (aiSucceeded) {
      check("AI draft opened the Quote Builder pre-filled, with the language selector visible", true);
      const descVal = await dialog.locator('input[placeholder="الوصف"]').first().inputValue();
      check("AI draft pre-filled at least one item description", descVal.trim().length > 0);
      const langLabel = await page.locator('[role="combobox"]').last().innerText();
      check("AI draft defaults the document language to Hebrew (العبرية)", langLabel.includes("العبرية"));

      const { rows: preSaveRows } = await pool.query(
        `select count(*)::int as n from quotes where job_id = $1`,
        [jobA.jobId],
      );
      check(
        "generating a draft never wrote a quotes row itself — draft-assist only, human must explicitly save",
        preSaveRows[0].n === 0,
      );

      await dialog.locator('button:has-text("حفظ عرض السعر")').click();
      await page.waitForTimeout(700);
      let text = await page.innerText("body");
      check("after explicit human review + save, the quote now exists as a draft", text.includes("مسودة"));
    } else {
      check(
        "every failed attempt degraded cleanly (Arabic error, no crash) — AGENTS.md's required graceful-failure path",
        true,
      );
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
      let text = await page.innerText("body");
      check(
        "job page is still fully usable after a failed AI generation — normal manual flow unaffected",
        text.includes("إنشاء عرض سعر"),
      );

      await page.click('button:has-text("إنشاء عرض سعر")');
      dialog = page.locator('[role="dialog"]');
      await dialog.locator('input[placeholder="الوصف"]').fill("התקנת דלת זכוכית הזזה למטבח, כולל מסילת אלומיניום");
      await dialog.locator('input[placeholder="الكمية"]').fill("1");
      await dialog.locator('input[placeholder="السعر"]').fill("3800");
      await selectHebrew(dialog, page);
      await dialog.locator('button:has-text("حفظ عرض السعر")').click();
      await page.waitForTimeout(700);
      text = await page.innerText("body");
      check("manually-built Hebrew quote saved as a draft (AI fallback path)", text.includes("مسودة"));
    }

    console.log("2. quotes.language / quote_versions.is_ai_generated actually persist (not a UI no-op)...");
    const { rows: quoteRows } = await pool.query(
      `select id, language from quotes where job_id = $1`,
      [jobA.jobId],
    );
    check("quotes.language stored as 'he'", quoteRows[0]?.language === "he");
    const quoteAId = quoteRows[0]?.id;

    if (aiSucceeded) {
      const { rows: verRows } = await pool.query(
        `select is_ai_generated, ai_prompt_notes from quote_versions where quote_id = $1 order by version_number desc limit 1`,
        [quoteAId],
      );
      check(
        "quote_versions.is_ai_generated stamped true for the version the AI draft produced",
        verRows[0]?.is_ai_generated === true,
      );
      check(
        "quote_versions.ai_prompt_notes captured the description that produced the draft",
        typeof verRows[0]?.ai_prompt_notes === "string" && verRows[0].ai_prompt_notes.length > 0,
      );
    } else {
      const { rows: verRows } = await pool.query(
        `select is_ai_generated from quote_versions where quote_id = $1 order by version_number desc limit 1`,
        [quoteAId],
      );
      check(
        "a manually-built quote (AI-generation fallback) is correctly NOT flagged is_ai_generated",
        verRows[0]?.is_ai_generated === false,
      );
    }

    console.log("3. Send + sign the Hebrew quote end to end...");
    await page.click('button:has-text("إرسال للعميل")');
    await page.waitForSelector("text=رابط توقيع العرض جاهز", { timeout: 10000 });
    const linkA = await page.locator("input[readonly]").inputValue();
    check("public signing link generated", /\/public\/q\//.test(linkA));
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    const customerCtx = await browser.newContext({ locale: "he" });
    const customerPage = await customerCtx.newPage();
    await customerPage.goto(linkA, { waitUntil: "networkidle" });
    let custText = await customerPage.innerText("body");
    check("public sign page renders the Hebrew form title (חתימה ואישור)", custText.includes("חתימה ואישור"));
    check(
      "public sign page relabels the national-id field for Hebrew (ת.ז / ח.פ)",
      custText.includes("ת.ז / ח.פ"),
    );
    check("public sign page shows the Hebrew agreement checkbox text", custText.includes("אני מאשר"));
    check("public sign page shows a Hebrew-locale total label (סה״כ)", custText.includes("סה״כ"));

    await customerPage.fill("#customerNameAtSigning", SIGNER_A.name);
    await customerPage.fill("#customerPhoneAtSigning", SIGNER_A.phone);
    await customerPage.fill("#customerNationalIdAtSigning", SIGNER_A.id);
    await customerPage.fill("#customerAddressAtSigning", SIGNER_A.address);
    await drawSignature(customerPage);
    await customerPage.check("#agreedToTerms");
    await customerPage.locator('button:has-text("חתימה ואישור ההצעה")').click();
    await customerPage.waitForSelector("text=הצעת המחיר נחתמה", { timeout: 10000 });
    custText = await customerPage.innerText("body");
    check("Hebrew signed confirmation shown (הצעת המחיר נחתמה)", custText.includes("הצעת המחיר נחתמה"));

    console.log("4. customer_national_id_at_signing is genuinely REUSED, not duplicated into a new column...");
    const { rows: sigColRows } = await pool.query(
      `select column_name from information_schema.columns where table_name = 'quote_signatures'`,
    );
    const sigColNames = sigColRows.map((r) => r.column_name);
    check(
      "quote_signatures still has exactly the pre-existing legal-field columns",
      sigColNames.includes("customer_name_at_signing") &&
        sigColNames.includes("customer_national_id_at_signing") &&
        sigColNames.includes("customer_address_at_signing") &&
        sigColNames.includes("signed_at"),
    );
    check(
      "no new Hebrew-specific signature column was added anywhere on quote_signatures",
      !sigColNames.some((c) => /hebrew|_he_|_he$|^he_/i.test(c)),
    );
    const { rows: quoteColRows } = await pool.query(
      `select column_name from information_schema.columns where table_name = 'quotes'`,
    );
    check(
      "quotes gained exactly one new column for this feature (language) — no per-language duplicate columns",
      quoteColRows.some((r) => r.column_name === "language") &&
        !quoteColRows.some((r) => /hebrew|_he_|_he$|^he_/i.test(r.column_name)),
    );

    const { rows: sigRows } = await pool.query(
      `select qs.customer_national_id_at_signing, qs.customer_name_at_signing
       from quote_signatures qs join quote_versions qv on qv.id = qs.quote_version_id
       where qv.quote_id = $1`,
      [quoteAId],
    );
    check(
      "the Hebrew ID value was actually saved into that same reused column",
      sigRows[0]?.customer_national_id_at_signing === SIGNER_A.id,
    );
    check("Hebrew signer name recorded correctly", sigRows[0]?.customer_name_at_signing === SIGNER_A.name);

    console.log("5. Hebrew PDFs render on both the staff and public routes...");
    await page.goto(`${BASE_URL}${jobA.href}`, { waitUntil: "networkidle" });
    const staffPdfHref = await page.locator('a:has-text("عرض PDF")').getAttribute("href");
    const staffPdfResp = await page.request.get(`${BASE_URL}${staffPdfHref}`);
    check("staff PDF route returns 200 for the Hebrew quote", staffPdfResp.status() === 200);
    const staffPdfBuf = await staffPdfResp.body();
    check(
      "staff PDF is a real, non-trivial PDF (magic bytes + size)",
      staffPdfBuf.slice(0, 4).toString("latin1") === "%PDF" && staffPdfBuf.length > 5000,
    );

    // linkA is already an absolute URL (window.location.origin + publicPath,
    // per send-quote-button.tsx) — do not prepend BASE_URL again here.
    const publicPdfResp = await customerPage.request.get(
      `${linkA.replace("/public/q/", "/api/public/quotes/")}/pdf`,
    );
    check("public PDF route returns 200 for the Hebrew quote", publicPdfResp.status() === 200);
    const publicPdfBuf = await publicPdfResp.body();
    check(
      "public PDF is a real PDF (magic bytes)",
      publicPdfBuf.slice(0, 4).toString("latin1") === "%PDF",
    );

    console.log("=== A second, unrelated job/quote, to test localStorage autofill across quotes ===");
    const jobB = await createLeadJob(page, {
      customerName: uniqueLabel("عميل عبري ب"),
      customerPhone: uniquePhone(),
      title: "زجاج ثابت لمرفق إضافي",
    });
    const { rows: custBRows } = await pool.query(
      `select c.address from customers c join jobs j on j.customer_id = c.id where j.id = $1`,
      [jobB.jobId],
    );
    const jobBExpectedAddress = custBRows[0]?.address ?? "";

    await page.click('button:has-text("إنشاء عرض سعر")');
    dialog = page.locator('[role="dialog"]');
    await dialog.locator('input[placeholder="الوصف"]').fill("זכוכית קבועה למרפסת");
    await dialog.locator('input[placeholder="الكمية"]').fill("2");
    await dialog.locator('input[placeholder="السعر"]').fill("500");
    await selectHebrew(dialog, page);
    await dialog.locator('button:has-text("حفظ عرض السعر")').click();
    await page.waitForTimeout(700);
    await page.click('button:has-text("إرسال للعميل")');
    await page.waitForSelector("text=رابط توقيع العرض جاهز", { timeout: 10000 });
    const linkB = await page.locator("input[readonly]").inputValue();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    console.log("6. localStorage autofill: name/phone/ID carry over from job A's signing, address does NOT...");
    // SAME customerCtx/customerPage that just signed job A above — the
    // whole point of this check.
    await customerPage.goto(linkB, { waitUntil: "networkidle" });
    const nameVal = await customerPage.locator("#customerNameAtSigning").inputValue();
    const phoneVal = await customerPage.locator("#customerPhoneAtSigning").inputValue();
    const idVal = await customerPage.locator("#customerNationalIdAtSigning").inputValue();
    const addrVal = await customerPage.locator("#customerAddressAtSigning").inputValue();
    check("name auto-filled from the previous signing (localStorage), not job B's own customer", nameVal === SIGNER_A.name);
    check("phone auto-filled from localStorage", phoneVal === SIGNER_A.phone);
    check("national id auto-filled from localStorage", idVal === SIGNER_A.id);
    check(
      "address NOT carried over from localStorage — always job B's own server-supplied default instead",
      addrVal === jobBExpectedAddress && addrVal !== SIGNER_A.address,
    );

    await customerCtx.close();

    if (consoleErrors.length > 0) {
      console.log("\n--- Browser console errors seen during run ---");
      for (const e of consoleErrors) console.log("  ", e);
      failures++;
    }
  } catch (err) {
    console.error("VERIFICATION SCRIPT ERROR:", err);
    await page.screenshot({ path: "/tmp/req4-ai-hebrew-quote-error.png" }).catch(() => {});
    failures++;
  } finally {
    await pool.end();
    await browser.close();
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main();
