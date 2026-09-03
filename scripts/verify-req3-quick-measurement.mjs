// Manual verification script for the "New Measurement" quick-submit flow
// (docs/superpowers/specs/2026-09-03-new-measurement-quick-submit-design.md)
// — not part of the automated test suite. Drives a real headless browser
// against the seeded demo data, plus direct DB reads via the pg Pool for
// assertions that aren't fully observable from the UI. Covers spec section
// 9's testing plan precisely: a CREATE_MEASUREMENT-only technician (Basel)
// submits a field measurement end to end; the resulting job/customer/
// measurement/attachment rows are correct in the DB; a second submission
// with the same phone reuses the existing customer; the new job appears in
// the dashboard's Needs Attention panel and in /jobs at the new status; a
// CREATE_PRICE holder (Mohammad) can pick it up and price it, completing
// the submit-to-review-to-price handoff; an authorized viewer can retrieve
// an attachment via /api/attachments/:id and an unauthorized one is
// rejected; cancelling this kind of job works exactly like cancelling any
// other job; and a file that fails the size/type limit is rejected
// server-side even when the client-side check is bypassed.
//
// Same convention as the other verify-phase*.mjs / verify-req*.mjs scripts:
// chromium.launch() with no executablePath override (uses Playwright's
// locally-installed browser), a plain check()/failures counter, a
// login()/DB-helper style, and a final pass/fail summary with a non-zero
// exit code on failure. Never hardcodes a job/customer/attachment row id —
// every id used is one this script itself just created (via the redirect
// URL a successful submission lands on) or reads back from the DB by a
// value it controls (a freshly generated test phone number), so it stays
// valid across a fresh `npm run db:seed`.
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright-core";
import { Pool } from "pg";

const BASE_URL = "http://localhost:3000";

// Same tiny 1x1 PNG this codebase's own seed.ts already uses as a
// placeholder image (TINY_PNG) — good enough for "a real, decodable image
// file", which is all the server-side validation (mime type from the
// browser's File object, not real image-content sniffing) actually checks.
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const TINY_PNG_BUFFER = Buffer.from(TINY_PNG_BASE64, "base64");

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

/** Mirrors src/server/tokens.ts's normalizePhone — local-only reimplementation
 * so this script can compute the same normalized phone the server action
 * itself will store, purely for DB lookups (never sent anywhere). */
function normalizePhone(raw) {
  const trimmed = raw.trim();
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 0) return "";
  if (hasPlus) return `+${digits}`;
  if (digits.startsWith("0")) return `+972${digits.slice(1)}`;
  return `+${digits}`;
}

/** Extracts the job id from a `/jobs/:id` URL the browser just landed on
 * (submitFieldMeasurementAction redirects there on success) — never a
 * hardcoded id. */
function jobIdFromUrl(url) {
  const m = new URL(url).pathname.match(/\/jobs\/([0-9a-fA-F-]{36})$/);
  return m ? m[1] : null;
}

/**
 * Rewrites one named part of an already-built multipart/form-data body,
 * replacing its filename/Content-Type/content while leaving every other
 * part (including whatever internal field(s) Next.js's Server Actions wire
 * protocol relies on to route the request) byte-for-byte untouched. Used
 * below to simulate a client that bypassed new-measurement-form.tsx's own
 * client-side file validation — a real attacker controls the raw HTTP
 * request, not just the form fields React renders — while still routing
 * through the exact same real request the legitimate browser submission
 * was about to send. Returns null if the named part can't be found (the
 * caller then skips the tamper and reports that check as failed rather
 * than crashing the script).
 */
function replaceMultipartFilePart(
  originalBuffer,
  contentTypeHeader,
  fieldName,
  newFileName,
  newMimeType,
  newContentBuffer,
) {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentTypeHeader ?? "");
  if (!boundaryMatch) return null;
  const boundary = (boundaryMatch[1] ?? boundaryMatch[2]).trim();
  const boundaryMarker = Buffer.from(`--${boundary}`);
  const CRLFCRLF = Buffer.from("\r\n\r\n");

  const markerPositions = [];
  let pos = 0;
  while (true) {
    const idx = originalBuffer.indexOf(boundaryMarker, pos);
    if (idx === -1) break;
    markerPositions.push(idx);
    pos = idx + boundaryMarker.length;
  }
  if (markerPositions.length < 2) return null;

  for (let i = 0; i < markerPositions.length - 1; i++) {
    const segStart = markerPositions[i];
    const segEnd = markerPositions[i + 1];
    const segment = originalBuffer.subarray(segStart, segEnd);
    const headerEnd = segment.indexOf(CRLFCRLF);
    if (headerEnd === -1) continue;
    const headerStr = segment.subarray(0, headerEnd).toString("latin1");
    // React's Server Actions wire protocol prefixes every field name with a
    // per-form id (e.g. "files" is actually sent as "_1_files") so multiple
    // forms/action instances on a page don't collide — match by suffix, not
    // exact name, and reuse whatever the real captured name was so the
    // server's own prefix-stripping still resolves it to "files".
    const nameMatch = headerStr.match(new RegExp(`name="([^"]*${fieldName})"`));
    if (!nameMatch || !headerStr.includes("filename=")) continue;
    const actualFieldName = nameMatch[1];

    const newDisposition = `Content-Disposition: form-data; name="${actualFieldName}"; filename="${newFileName}"`;
    const newHeaderStr = `${boundaryMarker.toString("latin1")}\r\n${newDisposition}\r\nContent-Type: ${newMimeType}`;
    const before = originalBuffer.subarray(0, segStart);
    const after = originalBuffer.subarray(segEnd);
    return Buffer.concat([
      before,
      Buffer.from(newHeaderStr, "latin1"),
      CRLFCRLF,
      newContentBuffer,
      Buffer.from("\r\n"),
      after,
    ]);
  }
  return null;
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

  async function jobById(id) {
    const { rows } = await pool.query(
      `select j.id, j.job_number, j.customer_id, j.title, j.measured_by_user_id,
              j.pricing_responsible_user_id, j.notes, js.key as status_key
       from jobs j join job_statuses js on js.id = j.status_id
       where j.id = $1`,
      [id],
    );
    return rows[0];
  }
  async function measurementByJob(jobId) {
    const { rows } = await pool.query(
      `select m.id, m.details, m.photos_taken, m.measured_by_user_id, m.glass_type_id, gt.label_ar as glass_type_label,
              m.field_quoted_price, m.field_quoted_price_includes_vat
       from measurements m
       left join glass_types gt on gt.id = m.glass_type_id
       where m.job_id = $1
       order by m.created_at desc limit 1`,
      [jobId],
    );
    return rows[0];
  }
  async function attachmentsByMeasurement(measurementId) {
    const { rows } = await pool.query(
      `select id, file_name, storage_path, mime_type, size_bytes
       from measurement_attachments where measurement_id = $1`,
      [measurementId],
    );
    return rows;
  }
  async function customersByPhone(phone) {
    const { rows } = await pool.query(
      `select id, name, phone from customers where phone = $1 and deleted_at is null`,
      [phone],
    );
    return rows;
  }
  async function jobItemsByJob(jobId) {
    const { rows } = await pool.query(
      `select id, sale_price, description from job_items where job_id = $1`,
      [jobId],
    );
    return rows;
  }

  const usersRes = await pool.query(
    `select id, phone from users where phone in ('+972501111111','+972502222222','+972503333333','+972504444444')`,
  );
  const idByPhone = Object.fromEntries(usersRes.rows.map((r) => [r.phone, r.id]));
  const baselId = idByPhone["+972504444444"];

  const testPhoneRaw = "0507002001";
  const testPhoneNormalized = normalizePhone(testPhoneRaw);
  const bypassPhoneRaw = "0507002099";
  const bypassPhoneNormalized = normalizePhone(bypassPhoneRaw);

  let jobId1, jobId2;
  let attachment1;

  try {
    // ===================================================================
    // Part A: a CREATE_MEASUREMENT-only technician (Basel) submits a new
    // field measurement end to end — My Day quick action -> dedicated form
    // -> redirect to the newly created job.
    // ===================================================================
    console.log("=== Part A: Basel (CREATE_MEASUREMENT-only) submits a field measurement ===");
    await login(page, "0504444444", "password123"); // Basel
    await page.goto(`${BASE_URL}/my-day`, { waitUntil: "networkidle" });
    check(
      "My Day shows the 'قياس جديد' quick action for a CREATE_MEASUREMENT holder",
      (await page.locator('a:has-text("قياس جديد")').count()) === 1,
    );
    await page.click('a:has-text("قياس جديد")');
    await page.waitForURL("**/my-day/new-measurement", { timeout: 10000 });

    await page.fill("#phone", testPhoneRaw);
    await page.fill("#customerName", "زبون ميداني اختباري");
    await page.click("#glassTypeId");
    await page.locator('[role="option"]:has-text("مقسّى")').click();
    await page.setInputFiles("#files", [
      { name: "site-photo.png", mimeType: "image/png", buffer: TINY_PNG_BUFFER },
    ]);
    await page.fill("#notes", "معاينة ميدانية: كسر في زجاج المطبخ، يحتاج استبدال.");
    await page.fill("#price", "1200");
    await page.click('button:has-text("شامل الضريبة")');

    await Promise.all([
      page.waitForURL(/\/jobs\/[0-9a-fA-F-]{36}$/, { timeout: 15000 }),
      page.click('button:has-text("إرسال القياس")'),
    ]);
    jobId1 = jobIdFromUrl(page.url());
    check("submission redirected to a newly created job detail page", !!jobId1);
    await page.waitForSelector("text=تم إرسال القياس الميداني بنجاح", { timeout: 10000 });

    const job1 = await jobById(jobId1);
    check("new job's status is field_submission_pending (DB)", job1?.status_key === "field_submission_pending");
    check("new job's measuredByUserId is Basel, the submitting user (DB)", job1?.measured_by_user_id === baselId);
    check("new job has no title (matches submitFieldMeasurementAction, which sets none) (DB)", job1?.title === null);
    check(
      "new job's pricing_responsible_user_id is left unset — a broadcast, not an assignment (DB)",
      job1?.pricing_responsible_user_id === null,
    );

    const customer1Rows = await customersByPhone(testPhoneNormalized);
    check("exactly one customer exists for the submitted phone (DB)", customer1Rows.length === 1);
    check("new job is linked to that customer (DB)", job1?.customer_id === customer1Rows[0]?.id);
    check(
      "customer name falls back correctly / uses the submitted name (DB)",
      customer1Rows[0]?.name === "زبون ميداني اختباري",
    );

    const measurement1 = await measurementByJob(jobId1);
    check("measurement row's measured_by matches Basel, the submitting user (DB)", measurement1?.measured_by_user_id === baselId);
    check("measurement row carries the selected glass type (DB)", measurement1?.glass_type_label === "مقسّى");
    check("measurement row's photosTaken is true (an image attachment was included) (DB)", measurement1?.photos_taken === true);
    check(
      "measurement row carries the on-site reference price and VAT-inclusion flag exactly as entered (DB)",
      measurement1?.field_quoted_price === "1200.00" && measurement1?.field_quoted_price_includes_vat === true,
    );

    const attachments1 = await attachmentsByMeasurement(measurement1.id);
    check("exactly one attachment row was created (DB)", attachments1.length === 1);
    attachment1 = attachments1[0];
    check("attachment row's file name matches what was uploaded (DB)", attachment1?.file_name === "site-photo.png");
    check("attachment row's mime type was recorded as image/png (DB)", attachment1?.mime_type === "image/png");
    check("attachment row's size matches the uploaded bytes (DB)", Number(attachment1?.size_bytes) === TINY_PNG_BUFFER.length);

    // ===================================================================
    // Part B: a second submission with the SAME phone number reuses the
    // existing customer rather than creating a duplicate.
    // ===================================================================
    console.log("\n=== Part B: second submission, same phone -> customer reused, not duplicated ===");
    await page.goto(`${BASE_URL}/my-day/new-measurement`, { waitUntil: "networkidle" });
    await page.fill("#phone", testPhoneRaw);
    // Deliberately leave customerName blank this time — a repeat caller
    // shouldn't need to re-supply it, and the existing customer's name
    // must not be overwritten by this second, name-less submission.
    await page.setInputFiles("#files", [
      { name: "site-photo-2.png", mimeType: "image/png", buffer: TINY_PNG_BUFFER },
    ]);
    await page.fill("#notes", "زيارة ثانية لنفس العميل لتأكيد القياس.");

    await Promise.all([
      page.waitForURL(/\/jobs\/[0-9a-fA-F-]{36}$/, { timeout: 15000 }),
      page.click('button:has-text("إرسال القياس")'),
    ]);
    jobId2 = jobIdFromUrl(page.url());
    check("second submission also redirected to a (different) newly created job", !!jobId2 && jobId2 !== jobId1);

    const job2 = await jobById(jobId2);
    check("second job is also at field_submission_pending (DB)", job2?.status_key === "field_submission_pending");

    const customersAfterSecond = await customersByPhone(testPhoneNormalized);
    check(
      "still exactly one customer for that phone after the second submission — no duplicate created (DB)",
      customersAfterSecond.length === 1,
    );
    check(
      "both jobs are linked to that SAME customer id (DB)",
      job1?.customer_id === customersAfterSecond[0]?.id && job2?.customer_id === customersAfterSecond[0]?.id,
    );
    check(
      "the existing customer's name from the FIRST submission was preserved, not blanked by the second (DB)",
      customersAfterSecond[0]?.name === "زبون ميداني اختباري",
    );

    // ===================================================================
    // Part C: both new jobs surface in the dashboard's Needs Attention
    // panel and in /jobs filtered to the new status.
    // ===================================================================
    console.log("\n=== Part C: dashboard Needs Attention panel + /jobs status filter ===");
    await ctx.clearCookies();
    await login(page, "0501111111", "password123"); // Amr: VIEW_ALL_JOBS + CREATE_PRICE
    await page.goto(`${BASE_URL}/dashboard`, { waitUntil: "networkidle" });
    let text = await page.innerText("body");
    check(
      "dashboard Needs Attention shows the 'قياسات ميدانية بانتظار المراجعة' category",
      text.includes("قياسات ميدانية بانتظار المراجعة"),
    );
    check("...and lists the first new job's number in its preview", text.includes(job1.job_number));
    check("...and lists the second new job's number in its preview", text.includes(job2.job_number));

    await page.goto(`${BASE_URL}/jobs?status=field_submission_pending`, { waitUntil: "networkidle" });
    text = await page.innerText("body");
    check("/jobs filtered to the new status lists the first new job", text.includes(job1.job_number));
    check("/jobs filtered to the new status lists the second new job", text.includes(job2.job_number));

    // ===================================================================
    // Part D: attachment retrieval — authorized viewer succeeds,
    // unauthorized viewer is rejected.
    // ===================================================================
    console.log("\n=== Part D: /api/attachments/:id authorized vs. unauthorized ===");
    const attachmentUrl = `${BASE_URL}/api/attachments/${attachment1.id}`;
    let resp = await page.request.get(attachmentUrl); // still Amr: VIEW_ALL_JOBS
    check("authorized viewer (VIEW_ALL_JOBS) retrieves the attachment (200)", resp.status() === 200);
    check("...with the correct stored MIME type", resp.headers()["content-type"] === "image/png");
    const bodyBuf = await resp.body();
    check("...and the correct bytes", bodyBuf.equals(TINY_PNG_BUFFER));

    await ctx.clearCookies();
    await login(page, "0503333333", "password123"); // Issam: VIEW_ASSIGNED_JOBS only, not involved in job1
    resp = await page.request.get(attachmentUrl);
    check(
      "unauthorized viewer (not involved in the job, no VIEW_ALL_JOBS) is rejected (403)",
      resp.status() === 403,
    );

    // ===================================================================
    // Part E: full submit-to-review-to-price handoff — a CREATE_PRICE
    // holder (Mohammad) opens the field-submitted job, sees the field data
    // rendered, and prices it via the existing pricing UI (AddJobItemDialog)
    // exactly as they would for an office-originated job.
    // ===================================================================
    console.log("\n=== Part E: CREATE_PRICE holder (Mohammad) reviews and prices the field submission ===");
    await ctx.clearCookies();
    await login(page, "0502222222", "password123"); // Mohammad: CREATE_PRICE/EDIT_PRICE
    await page.goto(`${BASE_URL}/jobs/${jobId1}`, { waitUntil: "networkidle" });
    text = await page.innerText("body");
    check("job detail page renders the glass type badge", text.includes("مقسّى"));
    check(
      "job detail page renders the on-site reference price, explicitly labeled non-binding",
      text.includes("سعر مرجعي من الميدان") && text.includes("غير ملزم"),
    );
    check("job detail page renders the uploaded attachment's file name", text.includes("site-photo.png"));

    await page.click('button:has-text("إضافة بند")');
    let dialog = page.locator('[role="dialog"]');
    await dialog.locator("#description").fill("استبدال زجاج مطبخ حسب القياس الميداني");
    await dialog.locator("#salePrice").fill("1200");
    await dialog.locator('button:has-text("إضافة البند")').click();
    await page.waitForSelector('[role="dialog"]', { state: "hidden", timeout: 10000 });
    await page.waitForTimeout(400);

    const items1 = await jobItemsByJob(jobId1);
    check(
      "Mohammad successfully priced the field-submitted job by adding a job item (DB) — handoff complete",
      items1.some((i) => i.sale_price === "1200.00"),
    );

    // ===================================================================
    // Part F: cancelling a field-submission job works exactly like
    // cancelling any other job — same CancelJobDialog, same CLOSE_DEAL gate.
    // ===================================================================
    console.log("\n=== Part F: cancel a field-submission job like any other job ===");
    await ctx.clearCookies();
    await login(page, "0501111111", "password123"); // Amr: CLOSE_DEAL
    await page.goto(`${BASE_URL}/jobs/${jobId2}`, { waitUntil: "networkidle" });
    check(
      "the cancel-job control appears on a field-submission job, same as any other non-terminal job",
      (await page.locator('button:has-text("إلغاء المهمة")').count()) === 1,
    );
    await page.click('button:has-text("إلغاء المهمة")');
    dialog = page.locator('[role="dialog"]');
    const cancelReason = `سبب إلغاء اختباري ${randomUUID().slice(0, 8)}`;
    await dialog.locator("#reason").fill(cancelReason);
    await dialog.locator('button:has-text("تأكيد إلغاء المهمة")').click();
    await page.waitForSelector('[role="dialog"]', { state: "hidden", timeout: 10000 });
    await page.waitForTimeout(400);

    const job2After = await jobById(jobId2);
    check("cancelling moves the job to 'cancelled', the same terminal status as any other job (DB)", job2After?.status_key === "cancelled");
    check("the cancellation reason was appended to jobs.notes, the same as any other job (DB)", job2After?.notes?.includes(cancelReason));

    // ===================================================================
    // Part G: a file that fails the size/type limit is rejected
    // server-side, even when the client-side check is bypassed — a real
    // attacker controls the raw HTTP request, not just the rendered form,
    // so this tampers with the actual network request the browser sends
    // (after a legitimate file passed the client-side check and the form
    // was really submitted) rather than trying to trick the React code.
    // ===================================================================
    console.log("\n=== Part G: server-side file validation survives a client-side bypass ===");
    await ctx.clearCookies();
    await login(page, "0504444444", "password123"); // Basel
    await page.goto(`${BASE_URL}/my-day/new-measurement`, { waitUntil: "networkidle" });

    const isNewMeasurementRequest = (url) => url.pathname === "/my-day/new-measurement";
    let tampered = false;
    await page.route(isNewMeasurementRequest, async (route) => {
      const req = route.request();
      if (req.method() !== "POST") {
        await route.continue();
        return;
      }
      const headers = await req.allHeaders();
      const contentType = headers["content-type"] ?? "";
      const body = req.postDataBuffer();
      if (!body || !contentType.includes("multipart/form-data")) {
        await route.continue();
        return;
      }
      const newBody = replaceMultipartFilePart(
        body,
        contentType,
        "files",
        "malware.exe",
        "application/x-msdownload",
        Buffer.from("MZ-this-is-not-an-image-or-pdf"),
      );
      if (!newBody) {
        await route.continue();
        return;
      }
      tampered = true;
      await route.continue({ postData: newBody });
    });

    await page.fill("#phone", bypassPhoneRaw);
    // A legitimate, allowed file is chosen here so the CLIENT-side check
    // in new-measurement-form.tsx passes and the real submission actually
    // fires — the route handler above swaps its content/type in flight,
    // simulating an attacker who bypassed the browser entirely.
    await page.setInputFiles("#files", [
      { name: "legit.png", mimeType: "image/png", buffer: TINY_PNG_BUFFER },
    ]);
    await page.click('button:has-text("إرسال القياس")');

    const rejected = await page
      .waitForSelector("text=غير مدعوم", { timeout: 10000 })
      .then(() => true)
      .catch(() => false);
    await page.unroute(isNewMeasurementRequest);

    check("the network-level tamper actually swapped the uploaded file before it reached the server", tampered);
    check(
      "server-side validateAttachmentFiles rejects the disallowed MIME type even though the client-side check was bypassed at the network layer",
      rejected,
    );
    check(
      "the browser did NOT navigate away to a new job — the rejected submission created nothing",
      !/\/jobs\/[0-9a-fA-F-]{36}$/.test(new URL(page.url()).pathname),
    );
    const bypassCustomers = await customersByPhone(bypassPhoneNormalized);
    check("no customer was created for the rejected bypass submission (DB)", bypassCustomers.length === 0);

    if (consoleErrors.length > 0) {
      console.log("\n--- Browser console errors seen during run ---");
      for (const e of consoleErrors) console.log("  ", e);
      failures++;
    }
  } catch (err) {
    console.error("VERIFICATION SCRIPT ERROR:", err);
    await page.screenshot({ path: "/tmp/verify-req3-quick-measurement-error.png" }).catch(() => {});
    failures++;
  } finally {
    await pool.end();
    await browser.close();
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main();
