// Manual verification script for Requirement 5 (auto-convert a signed quote
// into a job + auto-send it to the factory, right after the customer's own
// public e-signature — see src/server/quotes/actions.ts's
// runPostSignAutomation, src/server/quotes/convert.ts's
// applySignedQuoteToJob, and src/server/production/create-request.ts's
// createProductionRequest) — not part of the automated test suite. Drives a
// real headless browser against the running dev server, plus direct DB
// reads via the pg Pool for the checks the UI doesn't surface.
//
// REGRESSION COVERAGE NOTE: this script does not re-check quote-version
// immutability, the plain Arabic sign flow, or the factory reject/resubmit/
// approve cycle — those are scripts/verify-phase5.mjs / verify-phase6.mjs
// and tests/e2e/quotes.spec.ts / production.spec.ts / ahmad-scenario.spec.ts
// / financial.spec.ts / repairs.spec.ts, ALL of which were updated (to
// reflect the new automatic behavior honestly, never weakened) and re-run
// green against a fresh `npm run db:seed` as part of this same stage. This
// script is scoped to the NEW auto-routing surface only, and creates its
// own fresh jobs via /jobs/new (same convention as verify-req3/4.mjs), so
// it never touches or risks any pre-seeded job.
//
// Covers:
//   A. The happy path, end to end, with NO manual "تحويل إلى مهمة" /
//      "إرسال إلى المصنع" click anywhere: signing a quote via its public
//      link auto-converts the job (items, price, status, and
//      dealClosedByUserId correctly attributed to the QUOTE'S CREATOR, per
//      this feature's documented design — not a click-time actor, since
//      there is none) and auto-creates a production request + factory
//      public link — all confirmed directly against the DB, plus the job
//      page's own UI (manual buttons gone, auto-generated factory details
//      visible). Also confirms commission estimation later works correctly
//      off that auto-set dealClosedByUserId (ties back to Phase 8's
//      commission logic — the exact hard prerequisite AGENTS.md calls out).
//   B. The failure-and-fallback path: a quote whose createdByUserId AND
//      whose job's pricingResponsibleUserId are both null (an edge case
//      this script constructs directly in the DB — the real app can't
//      produce a null quotes.created_by_user_id through the UI itself, but
//      the column is nullable by schema, e.g. a since-deleted user via its
//      own onDelete: "set null") — confirms the signature itself still
//      commits successfully (the customer sees the normal confirmation, no
//      error), NOTHING is auto-converted (dealClosedByUserId cannot be
//      resolved), a notification is created for CLOSE_DEAL holders, and —
//      the main point — the existing manual convertQuoteToJob /
//      sendToFactoryAction actions are completely unbroken by this feature:
//      both manual buttons are still there and both still work exactly as
//      before, called directly through the real UI (not superseded).
//
// No executablePath override (let Playwright resolve its own managed
// browser), same as every other verify-phaseN.mjs / verify-reqN.mjs script.
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
  await page.context().clearCookies();
  await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle" });
  await page.fill("#phone", phone);
  await page.fill("#password", password);
  await Promise.all([
    page.waitForURL("**/dashboard", { timeout: 10000 }),
    page.click('button[type="submit"]'),
  ]);
}

/** Same helper tests/e2e/fixtures.ts's createLeadJob provides for
 * Playwright specs, reimplemented in plain JS since this script (like
 * every scripts/verify-*.mjs) runs directly under `node`. Never touches a
 * pre-seeded job/customer. */
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

/** Draws a couple of strokes on the signature <canvas> — same convention
 * as verify-phase5/6.mjs and tests/e2e/fixtures.ts's drawSignature. */
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

/** Creates a quote (one item), saves the draft, sends it, and returns the
 * public signing link — everything up to (but not including) the
 * customer's own signature. Caller must already be on the job's page,
 * logged in as a CREATE_QUOTE + SEND_QUOTE holder. */
async function createAndSendQuote(page, { description, price }) {
  await page.click('button:has-text("إنشاء عرض سعر")');
  const dialog = page.locator('[role="dialog"]');
  await dialog.locator('input[placeholder="الوصف"]').fill(description);
  await dialog.locator('input[placeholder="الكمية"]').fill("1");
  await dialog.locator('input[placeholder="السعر"]').fill(price);
  await dialog.locator('button:has-text("حفظ عرض السعر")').click();
  await page.waitForTimeout(700);

  await page.click('button:has-text("إرسال للعميل")');
  await page.waitForSelector("text=رابط توقيع العرض جاهز", { timeout: 10000 });
  const link = await page.locator("input[readonly]").inputValue();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  return link;
}

/** Signs a quote via its real public link, in a fresh cookie-less browser
 * context — no employee session involved at any point, matching how a real
 * customer would sign. Confirms the customer-facing confirmation appears
 * (the signature itself must commit and confirm no matter what the
 * best-effort automation after it does or doesn't do). */
async function signAsCustomer(browser, link) {
  const ctx = await browser.newContext({ locale: "ar" });
  const page = await ctx.newPage();
  await page.goto(link, { waitUntil: "networkidle" });
  await drawSignature(page);
  await page.check("#agreedToTerms");
  await page.locator('button:has-text("توقيع والموافقة على العرض")').click();
  const confirmed = await page
    .waitForSelector("text=تم توقيع عرض السعر", { timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  await ctx.close();
  return confirmed;
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

  async function jobRow(jobId) {
    const { rows } = await pool.query(
      `select j.id, j.deal_closed_by_user_id, j.sale_price_total, j.source_quote_version_id,
              j.pricing_responsible_user_id, js.key as status_key
       from jobs j join job_statuses js on js.id = j.status_id where j.id = $1`,
      [jobId],
    );
    return rows[0];
  }
  async function quoteByJob(jobId) {
    const { rows } = await pool.query(
      `select id, created_by_user_id, signed_version_id, status from quotes where job_id = $1`,
      [jobId],
    );
    return rows[0];
  }
  async function jobItemsByJob(jobId) {
    const { rows } = await pool.query(
      `select description, sale_price from job_items where job_id = $1`,
      [jobId],
    );
    return rows;
  }
  async function productionRequestByJob(jobId) {
    const { rows } = await pool.query(
      `select id, requested_by_user_id, details from production_requests where job_id = $1`,
      [jobId],
    );
    return rows[0];
  }
  async function factoryLinkByRequest(requestId) {
    const { rows } = await pool.query(
      `select token from factory_public_links where production_request_id = $1`,
      [requestId],
    );
    return rows[0];
  }
  async function auditActions(entityId) {
    const { rows } = await pool.query(
      `select action from audit_logs where entity_id = $1 order by created_at`,
      [entityId],
    );
    return rows.map((r) => r.action);
  }
  async function notificationsFor(userIds, relatedEntityId, type) {
    const { rows } = await pool.query(
      `select user_id, type, title from notifications
       where related_entity_id = $1 and type = $2 and user_id = any($3::uuid[])`,
      [relatedEntityId, type, userIds],
    );
    return rows;
  }

  const usersRes = await pool.query(
    `select id, phone from users where phone in ('+972501111111','+972502222222','+972503333333','+972504444444')`,
  );
  const idByPhone = Object.fromEntries(usersRes.rows.map((r) => [r.phone, r.id]));
  const amrId = idByPhone["+972501111111"];
  const mohammadId = idByPhone["+972502222222"];
  const issamId = idByPhone["+972503333333"];

  try {
    // ===================================================================
    // Part A: happy path — sign a quote, no manual clicks anywhere, and
    // confirm the whole cascade (convert + send-to-factory + commission)
    // ran correctly off it.
    // ===================================================================
    console.log("=== Part A: auto-convert + auto-send-to-factory, no manual clicks ===");
    await login(page, "0502222222", "password123"); // Mohammad: CREATE_QUOTE/SEND_QUOTE/CLOSE_DEAL/CREATE_PRODUCTION_ORDER/MANAGE_TECHNICIAN_PAYMENTS
    const jobA = await createLeadJob(page, {
      customerName: uniqueLabel("عميل توجيه تلقائي"),
      customerPhone: uniquePhone(),
      title: "اختبار التحويل والإرسال التلقائي",
    });
    const itemLabel = "زجاج اختبار توجيه تلقائي";
    const linkA = await createAndSendQuote(page, { description: itemLabel, price: "950" });

    const quoteBeforeSign = await quoteByJob(jobA.jobId);
    check(
      "quote's createdByUserId is Mohammad (he built + sent it) — the automation's real-world proxy for 'closed the deal'",
      quoteBeforeSign.created_by_user_id === mohammadId,
    );

    const signedOk = await signAsCustomer(browser, linkA);
    check("customer sees the normal signing confirmation (no error surfaced)", signedOk);

    const jobAAfter = await jobRow(jobA.jobId);
    check(
      "job auto-advanced straight to in_production (both auto-steps ran)",
      jobAAfter.status_key === "in_production",
    );
    check(
      "dealClosedByUserId auto-set to the quote's creator (Mohammad) — hard prerequisite for commission",
      jobAAfter.deal_closed_by_user_id === mohammadId,
    );
    check("job's salePriceTotal set from the signed version (950.00)", jobAAfter.sale_price_total === "950.00");

    const quoteAfterSign = await quoteByJob(jobA.jobId);
    check(
      "job's sourceQuoteVersionId matches the quote's own signedVersionId",
      jobAAfter.source_quote_version_id === quoteAfterSign.signed_version_id,
    );

    const itemsA = await jobItemsByJob(jobA.jobId);
    check(
      "job items were populated from the signed quote version (description + price)",
      itemsA.length === 1 && itemsA[0].description === itemLabel && itemsA[0].sale_price === "950.00",
    );

    const requestA = await productionRequestByJob(jobA.jobId);
    check("a production request was auto-created for the job", !!requestA);
    check(
      "production request's requestedByUserId is the same resolved actor (Mohammad)",
      requestA?.requested_by_user_id === mohammadId,
    );
    check(
      "auto-generated details text mentions the job's own item (mirrors the manual dialog's own convention)",
      !!requestA?.details && requestA.details.includes(itemLabel),
    );

    const factoryLinkRow = requestA && (await factoryLinkByRequest(requestA.id));
    check("a factory public link was auto-created for that production request", !!factoryLinkRow?.token);

    const jobAuditActions = await auditActions(jobA.jobId);
    check(
      "audit trail carries quote.convert_to_job — the same action the manual button would have written",
      jobAuditActions.includes("quote.convert_to_job"),
    );
    const requestAuditActions = requestA ? await auditActions(requestA.id) : [];
    check(
      "audit trail carries production_request.create for the auto-created request",
      requestAuditActions.includes("production_request.create"),
    );

    const successNotifs = await notificationsFor(
      [mohammadId, amrId],
      jobA.jobId,
      "quote_auto_converted_and_sent",
    );
    check(
      "a success notification was created for the resolved actor / CREATE_PRODUCTION_ORDER holders",
      successNotifs.length > 0,
    );

    // UI confirmation: log back in as Amr (VIEW_ALL_JOBS) and read the job
    // page itself — neither manual button should exist (their step already
    // happened), and the auto-generated production details should be
    // visible on the page.
    await login(page, "0501111111", "password123"); // Amr
    await page.goto(`${BASE_URL}${jobA.href}`, { waitUntil: "networkidle" });
    let text = await page.innerText("body");
    check("no manual convert-to-job button on the job page", !text.includes("تحويل العرض إلى مهمة"));
    check("no manual send-to-factory button on the job page", !text.includes("إرسال إلى المصنع"));
    check("job page shows the auto-created production request's details", text.includes(itemLabel));
    check("job page shows the quote as signed", text.includes("تم توقيع هذا العرض من العميل"));

    // Commission estimation, off the auto-set dealClosedByUserId — the
    // exact tie-in to Phase 8's commission logic AGENTS.md calls out.
    await login(page, "0502222222", "password123"); // Mohammad: MANAGE_TECHNICIAN_PAYMENTS
    await page.goto(`${BASE_URL}${jobA.href}`, { waitUntil: "networkidle" });
    await page.click('button:has-text("تقدير العمولة")');
    const estimateOk = await page
      .waitForSelector("text=تم تحديث تقدير العمولة", { timeout: 10000 })
      .then(() => true)
      .catch(() => false);
    check(
      "commission estimation SUCCEEDS off the auto-set dealClosedByUserId (would fail with a clear Arabic error otherwise)",
      estimateOk,
    );
    const { rows: rateRows } = await pool.query(
      `select value from application_settings where key = 'commission_rate_percent'`,
    );
    const ratePercent = rateRows[0] ? Number(rateRows[0].value) : 10;
    const expectedAmount = (950 * (ratePercent / 100)).toFixed(2);
    const { rows: commissionRows } = await pool.query(
      `select closed_by_user_id, estimated_gross_profit, estimated_amount, rate_percent
       from commissions where job_id = $1`,
      [jobA.jobId],
    );
    check(
      "commissions row's closedByUserId matches the auto-set dealClosedByUserId (Mohammad)",
      commissionRows[0]?.closed_by_user_id === mohammadId,
    );
    check(
      `commissions row computed correctly off the auto path (grossProfit 950.00, amount ${expectedAmount})`,
      commissionRows[0]?.estimated_gross_profit === "950.00" &&
        commissionRows[0]?.estimated_amount === expectedAmount,
    );

    // ===================================================================
    // Part B: failure-and-fallback — an unresolvable actor (both
    // quotes.created_by_user_id AND jobs.pricing_responsible_user_id are
    // null). The real app never produces this through its own UI (every
    // quote is created by a logged-in CREATE_QUOTE holder), but the
    // column is nullable by schema (onDelete: "set null" — e.g. the
    // creator's account was later deleted), so this constructs the edge
    // case directly in the DB to exercise runPostSignAutomation's own
    // documented fallback: notify CLOSE_DEAL holders and stop, leaving
    // the manual buttons as the required, fully-working fallback.
    // ===================================================================
    console.log(
      "\n=== Part B: unresolvable actor -> notification, no auto-convert, manual buttons still work ===",
    );
    await login(page, "0502222222", "password123"); // Mohammad
    const jobB = await createLeadJob(page, {
      customerName: uniqueLabel("عميل تراجع تلقائي"),
      customerPhone: uniquePhone(),
      title: "اختبار التراجع اليدوي",
    });
    const itemLabelB = "زجاج اختبار تراجع";
    const linkB = await createAndSendQuote(page, { description: itemLabelB, price: "600" });

    const jobBBefore = await jobRow(jobB.jobId);
    check(
      "jobB's pricingResponsibleUserId is null (no measurement step ran) — the fallback also has nothing to fall back to",
      jobBBefore.pricing_responsible_user_id === null,
    );

    const quoteB = await quoteByJob(jobB.jobId);
    // Directly null out the quote's createdByUserId — the one piece of
    // this scenario the real UI can't produce on its own, per this
    // script's own header comment.
    await pool.query(`update quotes set created_by_user_id = null where id = $1`, [quoteB.id]);
    const quoteBNulled = await quoteByJob(jobB.jobId);
    check("quoteB's createdByUserId is now null (constructed edge case)", quoteBNulled.created_by_user_id === null);

    const signedOkB = await signAsCustomer(browser, linkB);
    check(
      "the signature itself still commits and confirms normally — a downstream automation problem never surfaces to the customer",
      signedOkB,
    );

    const jobBAfter = await jobRow(jobB.jobId);
    check(
      "job's own status DID move to quote_signed (that write is inside the signature transaction itself, unconditional)",
      jobBAfter.status_key === "quote_signed",
    );
    check(
      "job was NOT auto-converted — dealClosedByUserId still null (no resolvable actor)",
      jobBAfter.deal_closed_by_user_id === null,
    );
    const itemsB = await jobItemsByJob(jobB.jobId);
    check("no job items were created by the automation", itemsB.length === 0);
    const requestB = await productionRequestByJob(jobB.jobId);
    check("no production request was auto-created (conversion never ran, so the factory step never even attempted)", !requestB);

    const fallbackNotifs = await notificationsFor(
      [amrId, mohammadId, issamId],
      jobB.jobId,
      "quote_auto_convert_needs_manual",
    );
    check(
      "a 'needs manual conversion' notification was created for a CLOSE_DEAL holder",
      fallbackNotifs.length > 0,
    );
    const jobBAuditActions = await auditActions(jobB.jobId);
    check(
      "no quote.convert_to_job / auto_convert_failed audit entries — the automation stopped before attempting anything",
      !jobBAuditActions.includes("quote.convert_to_job") &&
        !jobBAuditActions.includes("quote.auto_convert_failed"),
    );

    // The manual fallback: convert, exactly as any manually-signed quote
    // always could — proves convertQuoteToJob is completely unbroken by
    // this feature, still reachable, and still attributes to the ACTING
    // user when there's a real click behind it (unlike the auto path).
    await login(page, "0501111111", "password123"); // Amr: CLOSE_DEAL holder
    await page.goto(`${BASE_URL}${jobB.href}`, { waitUntil: "networkidle" });
    text = await page.innerText("body");
    check(
      "manual 'تحويل العرض إلى مهمة' button IS present (the automation never consumed this quote's conversion)",
      text.includes("تحويل العرض إلى مهمة"),
    );
    await page.click('button:has-text("تحويل العرض إلى مهمة")');
    await page.locator('[role="alertdialog"] button:has-text("تحويل"):not(:has-text("العرض"))').click();
    await page.waitForTimeout(800);
    text = await page.innerText("body");
    check("manual conversion succeeded (job items now show the quote's item)", text.includes(itemLabelB));

    const jobBAfterManualConvert = await jobRow(jobB.jobId);
    check(
      "manual conversion attributes dealClosedByUserId to the ACTING user (Amr) — unchanged manual behavior",
      jobBAfterManualConvert.deal_closed_by_user_id === amrId,
    );
    check(
      "job status advanced to waiting_for_production via the manual path (not straight to in_production — no auto-send ran)",
      jobBAfterManualConvert.status_key === "waiting_for_production",
    );

    // The manual fallback: send to factory, exactly as before — proves
    // sendToFactoryAction is also completely unbroken by this feature.
    check("manual 'إرسال إلى المصنع' button IS present", text.includes("إرسال إلى المصنع"));
    await page.click('button:has-text("إرسال إلى المصنع")');
    const sendDialog = page.locator('[role="dialog"]');
    const prefillB = await sendDialog.locator("#details").inputValue();
    check("send-to-factory dialog still prefills from the job's own items, unchanged", prefillB.includes(itemLabelB));
    await sendDialog.locator('button:has-text("إرسال إلى المصنع")').click();
    const sentOk = await page
      .waitForSelector("text=تم إنشاء طلب الإنتاج", { timeout: 10000 })
      .then(() => true)
      .catch(() => false);
    check("manual send-to-factory succeeded", sentOk);
    const factoryLinkB = await sendDialog.locator("input[readonly]").inputValue();
    await sendDialog.locator('button:has-text("تم")').click();
    await page.waitForTimeout(300);

    const requestBAfterManual = await productionRequestByJob(jobB.jobId);
    check(
      "manual send-to-factory created the production request, attributed to the ACTING user (Amr)",
      requestBAfterManual?.requested_by_user_id === amrId,
    );
    check("manual factory link matches what the dialog showed", /\/public\/pr\//.test(factoryLinkB));

    const jobBFinal = await jobRow(jobB.jobId);
    check("job status advanced to in_production via the manual send", jobBFinal.status_key === "in_production");

    if (consoleErrors.length > 0) {
      console.log("\n--- Browser console errors seen during run ---");
      for (const e of consoleErrors) console.log("  ", e);
      failures++;
    }
  } catch (err) {
    console.error("VERIFICATION SCRIPT ERROR:", err);
    await page.screenshot({ path: "/tmp/verify-req5-auto-routing-error.png" }).catch(() => {});
    failures++;
  } finally {
    await pool.end();
    await browser.close();
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main();
