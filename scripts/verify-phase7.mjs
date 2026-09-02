// Manual verification script for Phase 7 (Scheduling/Calendar/My Day,
// customer payments + approval, complete-installation) — not part of the
// automated test suite. Drives a real headless browser against the seeded
// demo data, plus direct DB reads/writes via the pg Pool for the
// financial-integrity and permission-scoping checks that aren't fully
// observable from the UI (cash_transactions, approval_requests.rejection
// reason, and a temporary permission revoke for the "no scheduling
// permission at all" check). Finds jobs by their stable seeded numbers via
// the UI (never a hardcoded row id), same convention as
// verify-phase5.mjs/verify-phase6.mjs, so it stays valid across a fresh
// `npm run db:seed`.
//
// IMPORTANT DIFFERENCE FROM verify-phase5.mjs/verify-phase6.mjs: those
// hardcode executablePath to a sandbox-only Chromium binary that does not
// exist on this machine. This script calls chromium.launch() with no
// executablePath override, so Playwright's locally-installed browser
// (~/Library/Caches/ms-playwright/) is used instead.
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

// --- local "today"/"tomorrow at HH:MM" helpers, matching seed.ts's own
// todayAt/tomorrowAt convention, for both <input type="datetime-local">
// values and the /api/appointments day-range fetch below. ---
function pad(n) {
  return String(n).padStart(2, "0");
}
function datetimeLocalValue(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function todayAt(hour, minute = 0) {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d;
}
function localDayBoundsIso(offsetDays = 0) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offsetDays, 0, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offsetDays + 1, 0, 0, 0, 0);
  return { start: start.toISOString(), end: end.toISOString() };
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

  // Seeded user ids, fetched once via direct DB query (used throughout for
  // #assignee-<id> checkboxes and cash-account/permission checks).
  const usersRes = await pool.query(
    `select id, phone from users where phone in ('+972501111111','+972502222222','+972503333333','+972504444444')`,
  );
  const idByPhone = Object.fromEntries(usersRes.rows.map((r) => [r.phone, r.id]));
  const amrId = idByPhone["+972501111111"];
  const mohammadId = idByPhone["+972502222222"];
  const issamId = idByPhone["+972503333333"];
  const baselId = idByPhone["+972504444444"];

  async function jobStatusKey(jobNumber) {
    const { rows } = await pool.query(
      `select js.key from jobs j join job_statuses js on js.id = j.status_id where j.job_number = $1`,
      [jobNumber],
    );
    return rows[0]?.key;
  }
  async function appointmentStatus(jobNumber, type) {
    const { rows } = await pool.query(
      `select a.status from appointments a join jobs j on j.id = a.job_id
       where j.job_number = $1 and a.type = $2 order by a.scheduled_start desc limit 1`,
      [jobNumber, type],
    );
    return rows[0]?.status;
  }
  async function latestPayment(jobNumber) {
    const { rows } = await pool.query(
      `select cp.* from customer_payments cp join jobs j on j.id = cp.job_id
       where j.job_number = $1 order by cp.created_at desc limit 1`,
      [jobNumber],
    );
    return rows[0];
  }
  async function cashTransactionFor(paymentId, ownerUserId, amount) {
    const { rows } = await pool.query(
      `select ct.* from cash_transactions ct join cash_accounts ca on ca.id = ct.cash_account_id
       where ct.source_id = $1 and ca.owner_user_id = $2 and ct.amount = $3 and ct.direction = 'in'`,
      [paymentId, ownerUserId, amount],
    );
    return rows[0] ?? null;
  }

  let reemHref, ahmadHref;
  let jobANumber, jobAId, jobCNumber;

  try {
    console.log("=== Setup: locate seeded jobs ===");
    await login(page, "0502222222", "password123"); // Mohammad
    reemHref = await jobHrefByNumber(page, "JOB-2026-0004");
    ahmadHref = await jobHrefByNumber(page, "JOB-2026-0001");

    // -----------------------------------------------------------------
    // Part A: scheduling mechanics — create a fresh job (starts at
    // new_lead so advancing to measurement_scheduled is an observable
    // forward move), schedule a measurement appointment on it, confirm
    // the status advance + My Day's "today only" filter.
    // -----------------------------------------------------------------
    console.log("\n--- Part A: schedule a measurement appointment (status advance + My Day date filter) ---");
    await page.goto(`${BASE_URL}/jobs/new`, { waitUntil: "networkidle" });
    await page.click('button:has-text("عميل جديد")');
    await page.fill("#newCustomerName", "زبون اختبار قياس فيز 7");
    await page.fill("#newCustomerPhone", "+972500009001");
    await page.fill("#title", "اختبار جدولة قياس");
    await Promise.all([
      page.waitForURL(/\/jobs\/[0-9a-f-]{36}$/, { timeout: 10000 }),
      page.click('button:has-text("إنشاء المهمة")'),
    ]);
    jobAId = new URL(page.url()).pathname.split("/").pop();
    jobANumber = (await page.locator("h1").first().innerText()).trim();
    let text = await page.innerText("body");
    check("new job A starts at new_lead", text.includes("عميل محتمل جديد"));

    await page.click('button:has-text("جدولة موعد")');
    let dialog = page.locator('[role="dialog"]');
    await dialog.locator("#scheduledStart").fill(datetimeLocalValue(todayAt(14, 0)));
    await dialog.locator(`#assignee-${baselId}`).click(); // measurement type is the dialog's default
    await dialog.locator('button:has-text("جدولة")').click();
    await page.waitForSelector("text=تم جدولة الموعد بنجاح", { timeout: 10000 });
    await page.waitForTimeout(400);
    text = await page.innerText("body");
    check("job A status badge advanced to measurement_scheduled", text.includes("تحديد موعد القياس"));
    check(
      "job_statuses key advanced to measurement_scheduled (DB)",
      (await jobStatusKey(jobANumber)) === "measurement_scheduled",
    );

    // A second appointment on the same job, assigned ONLY to Mohammad
    // (customer_meeting -> VIEW_ALL_JOBS), today — this is the negative
    // control for the Calendar API permission-scoping check below: a
    // technician without VIEW_ALL_JOBS who isn't assigned to it must not
    // get it back from /api/appointments.
    await page.click('button:has-text("جدولة موعد")');
    dialog = page.locator('[role="dialog"]');
    await dialog.locator("#type").click();
    await page.locator('[role="option"]:has-text("لقاء عميل")').click();
    await dialog.locator("#scheduledStart").fill(datetimeLocalValue(todayAt(16, 0)));
    await dialog.locator(`#assignee-${mohammadId}`).click();
    await dialog.locator('button:has-text("جدولة")').click();
    await page.waitForSelector("text=تم جدولة الموعد بنجاح", { timeout: 10000 });
    await page.waitForTimeout(400);
    text = await page.innerText("body");
    check("job A now also has a customer_meeting appointment (Mohammad only)", text.includes("لقاء عميل"));

    // -----------------------------------------------------------------
    // Part B: an installation appointment with two assignees, scheduled
    // to deliberately overlap Basel's just-created measurement — the
    // non-blocking conflict-warning check — then Calendar/My Day.
    // -----------------------------------------------------------------
    console.log("\n--- Part B: installation appointment (two assignees, conflict warning, Calendar/My Day) ---");
    await page.goto(`${BASE_URL}/jobs/new`, { waitUntil: "networkidle" });
    await page.click('button:has-text("عميل جديد")');
    await page.fill("#newCustomerName", "زبون اختبار تركيب فيز 7");
    await page.fill("#newCustomerPhone", "+972500009002");
    await page.fill("#title", "اختبار جدولة تركيب");
    await Promise.all([
      page.waitForURL(/\/jobs\/[0-9a-f-]{36}$/, { timeout: 10000 }),
      page.click('button:has-text("إنشاء المهمة")'),
    ]);
    jobCNumber = (await page.locator("h1").first().innerText()).trim();

    await page.click('button:has-text("جدولة موعد")');
    dialog = page.locator('[role="dialog"]');
    await dialog.locator("#type").click();
    await page.locator('[role="option"]:has-text("تركيب")').click();
    // 14:30 deliberately overlaps job A's 14:00 (no end -> 1hr virtual
    // block) measurement, which Basel is also assigned to.
    await dialog.locator("#scheduledStart").fill(datetimeLocalValue(todayAt(14, 30)));
    await dialog.locator(`#assignee-${issamId}`).click();
    await dialog.locator(`#assignee-${baselId}`).click();
    await dialog.locator('button:has-text("جدولة")').click();
    let conflictToastSeen = false;
    try {
      await page.waitForSelector("text=تعارض", { timeout: 5000 });
      conflictToastSeen = true;
    } catch {
      // Fallback per the task spec: if the ephemeral toast's timing is
      // missed, it's enough that the appointment was still created
      // (non-blocking conflicts must never prevent the write).
    }
    await page.waitForTimeout(400);
    text = await page.innerText("body");
    check(
      "overlapping schedule still succeeded, with a conflict warning if the toast was caught in time",
      conflictToastSeen || text.includes("تحديد موعد التركيب"),
    );
    check("job C status badge advanced to installation_scheduled", text.includes("تحديد موعد التركيب"));
    check(
      "job_statuses key advanced to installation_scheduled (DB)",
      (await jobStatusKey(jobCNumber)) === "installation_scheduled",
    );

    console.log("Calendar API: VIEW_ALL_JOBS user (Mohammad) sees everything scheduled today...");
    const { start: todayStart, end: todayEnd } = localDayBoundsIso(0);
    let res = await page.request.get(
      `${BASE_URL}/api/appointments?start=${encodeURIComponent(todayStart)}&end=${encodeURIComponent(todayEnd)}`,
    );
    check("Mohammad's /api/appointments call succeeds", res.ok());
    let events = await res.json();
    check(
      "Mohammad (VIEW_ALL_JOBS) sees job A's customer_meeting appointment",
      events.some((e) => e.title.includes(jobANumber) && e.extendedProps.type === "customer_meeting"),
    );
    check(
      "Mohammad (VIEW_ALL_JOBS) sees job C's installation appointment",
      events.some((e) => e.title.includes(jobCNumber) && e.extendedProps.type === "installation"),
    );

    console.log("Calendar API: a plain technician (Basel, no VIEW_ALL_JOBS) only gets his own appointments back...");
    await employeeCtx.clearCookies();
    await login(page, "0504444444", "password123"); // Basel
    res = await page.request.get(
      `${BASE_URL}/api/appointments?start=${encodeURIComponent(todayStart)}&end=${encodeURIComponent(todayEnd)}`,
    );
    check("Basel's /api/appointments call succeeds", res.ok());
    events = await res.json();
    check(
      "Basel is NOT returned job A's customer_meeting appointment (not his assignee) — permission scoping",
      !events.some((e) => e.title.includes(jobANumber) && e.extendedProps.type === "customer_meeting"),
    );
    check(
      "Basel IS returned job A's own measurement appointment (he is assigned)",
      events.some((e) => e.title.includes(jobANumber) && e.extendedProps.type === "measurement"),
    );
    check(
      "Basel IS returned job C's installation appointment (he is assigned)",
      events.some((e) => e.title.includes(jobCNumber) && e.extendedProps.type === "installation"),
    );
    check(
      "Basel IS returned Reem's pre-seeded installation appointment (he is assigned)",
      events.some((e) => e.title.includes("JOB-2026-0004") && e.extendedProps.type === "installation"),
    );

    console.log("My Day: today's appointments show up for both installation assignees (Issam + Basel)...");
    await page.goto(`${BASE_URL}/my-day`, { waitUntil: "networkidle" });
    text = await page.innerText("body");
    check("Basel's My Day shows job A (today's measurement, 10:00-scoped test)", text.includes(jobANumber));
    check("Basel's My Day shows job C (today's installation)", text.includes(jobCNumber));
    check("Basel's My Day shows Reem's job (today's installation)", text.includes("JOB-2026-0004"));
    check("Basel's My Day shows Sara's job (today's re-measurement)", text.includes("JOB-2026-0002"));
    check(
      "Basel's My Day does NOT show job A's customer_meeting (not his assignee)",
      !text.includes("لقاء عميل"),
    );
    check(
      "Basel's My Day does NOT show Nabil's repair (scheduled for tomorrow, not today) — confirms the 'today only' filter",
      !text.includes("JOB-2026-0005"),
    );

    await employeeCtx.clearCookies();
    await login(page, "0503333333", "password123"); // Issam
    await page.goto(`${BASE_URL}/my-day`, { waitUntil: "networkidle" });
    text = await page.innerText("body");
    check("Issam's My Day shows job C (today's installation, second assignee)", text.includes(jobCNumber));
    check("Issam's My Day shows Reem's job (today's installation, second assignee)", text.includes("JOB-2026-0004"));
    check("Issam's My Day does NOT show job A (not his assignee)", !text.includes(jobANumber));
    check(
      "Issam's My Day does NOT show Nabil's repair (scheduled for tomorrow, not today)",
      !text.includes("JOB-2026-0005"),
    );

    // -----------------------------------------------------------------
    // Part C: cancel an appointment — disappears from My Day/Calendar,
    // job status untouched (cancelAppointmentAction never calls
    // advanceJobStatus).
    // -----------------------------------------------------------------
    console.log("\n--- Part C: cancel job A's measurement appointment ---");
    await employeeCtx.clearCookies();
    await login(page, "0502222222", "password123"); // Mohammad
    await page.goto(`${BASE_URL}/jobs/${jobAId}`, { waitUntil: "networkidle" });
    const scheduleCard = page.locator('[data-slot="card"]', { hasText: "الجدولة" });
    check("job A schedule card has 2 cancel buttons before cancelling", (await scheduleCard.locator('[aria-label="حذف"]').count()) === 2);
    // Soonest-first ordering (see getJobAppointments) — the 14:00
    // measurement sorts before the 16:00 customer_meeting.
    await scheduleCard.locator('[aria-label="حذف"]').first().click();
    await page.locator('[role="alertdialog"] button:has-text("حذف")').click();
    await page.waitForTimeout(700);
    text = await page.innerText("body");
    check(
      "job A operational status untouched by cancelling (still measurement_scheduled)",
      text.includes("تحديد موعد القياس"),
    );
    check(
      "cancelled appointment's own status flipped to cancelled (DB)",
      (await appointmentStatus(jobANumber, "measurement")) === "cancelled",
    );
    check("job A schedule card now has only 1 cancel button", (await scheduleCard.locator('[aria-label="حذف"]').count()) === 1);

    await employeeCtx.clearCookies();
    await login(page, "0504444444", "password123"); // Basel
    await page.goto(`${BASE_URL}/my-day`, { waitUntil: "networkidle" });
    text = await page.innerText("body");
    check("cancelled appointment gone from Basel's My Day (job A no longer listed at all)", !text.includes(jobANumber));

    await employeeCtx.clearCookies();
    await login(page, "0502222222", "password123"); // Mohammad
    res = await page.request.get(
      `${BASE_URL}/api/appointments?start=${encodeURIComponent(todayStart)}&end=${encodeURIComponent(todayEnd)}`,
    );
    events = await res.json();
    check(
      "cancelled appointment gone from the Calendar API results",
      !events.some((e) => e.title.includes(jobANumber) && e.extendedProps.type === "measurement"),
    );

    // -----------------------------------------------------------------
    // Part D: unauthorized — a user holding NONE of the four scheduling
    // permissions cannot see the "schedule appointment" trigger, even on
    // a job they ARE otherwise involved in. The four qualifying
    // permissions are create_measurement/assign_installer/create_repair/
    // view_all_jobs (src/app/(app)/jobs/[id]/page.tsx's
    // canScheduleAppointment = canAny(...)). Basel is seeded holding TWO
    // of those four — create_measurement AND create_repair — so both must
    // be stripped to actually reach "none of the 4"; stripping only
    // create_measurement (as this script originally did) still leaves
    // create_repair, and the trigger correctly stays visible. Strip both
    // via a direct DB write, check the DOM, then restore both — mirroring
    // the DOM-absence permission-denial pattern from
    // verify-phase5.mjs/verify-phase6.mjs.
    // -----------------------------------------------------------------
    console.log("\n--- Part D: unauthorized — no scheduling permission at all ---");
    const baselSchedulingKeys = ["create_measurement", "create_repair"];
    await pool.query(
      `delete from user_permissions where user_id = $1 and permission_key = any($2::text[])`,
      [baselId, baselSchedulingKeys],
    );
    try {
      await employeeCtx.clearCookies();
      await login(page, "0504444444", "password123"); // Basel
      await page.goto(`${BASE_URL}${ahmadHref}`, { waitUntil: "networkidle" }); // Basel is involved (measured + assigned)
      text = await page.innerText("body");
      check("Basel (still involved) can open Ahmad's job", text.includes("JOB-2026-0001"));
      check(
        "Basel, now holding none of the 4 scheduling permissions, has no 'جدولة موعد' trigger",
        (await page.locator('button:has-text("جدولة موعد")').count()) === 0,
      );
    } finally {
      for (const key of baselSchedulingKeys) {
        await pool.query(
          `insert into user_permissions (user_id, permission_key, granted_by_user_id)
           values ($1, $2, $3) on conflict do nothing`,
          [baselId, key, amrId],
        );
      }
    }
    // Confirm the restore actually took (next login reflects fresh permissions).
    await employeeCtx.clearCookies();
    await login(page, "0504444444", "password123");
    await page.goto(`${BASE_URL}${ahmadHref}`, { waitUntil: "networkidle" });
    check(
      "Basel's scheduling permissions (and 'جدولة موعد' trigger) restored after the test",
      (await page.locator('button:has-text("جدولة موعد")').count()) === 1,
    );

    // -----------------------------------------------------------------
    // Part E: complete installation from My Day (Reem's pre-seeded,
    // multi-technician installation appointment) — items -> installed,
    // job -> installed, a cash payment recorded pending (Basel has
    // collect_payment but not approve_payment).
    // -----------------------------------------------------------------
    console.log("\n--- Part E: complete Reem's installation (items + a pending cash payment) ---");
    await page.goto(`${BASE_URL}/my-day`, { waitUntil: "networkidle" });
    const reemCard = page.locator('[data-slot="card"]', { hasText: "JOB-2026-0004" });
    await reemCard.locator('button:has-text("إكمال التركيب")').click();
    dialog = page.locator('[role="dialog"]');
    await dialog.locator("#paymentCollected").click();
    await dialog.locator("#paymentAmount").fill("2500");
    await dialog.locator('button:has-text("إكمال التركيب")').last().click();
    await page.waitForSelector("text=تم إكمال التركيب", { timeout: 10000 });
    await page.waitForTimeout(500);

    check("Reem's job advanced to installed (DB)", (await jobStatusKey("JOB-2026-0004")) === "installed");
    const reemItemsRes = await pool.query(
      `select status from job_items where job_id = (select id from jobs where job_number = 'JOB-2026-0004')`,
    );
    check(
      "Reem's job item(s) now status=installed (DB)",
      reemItemsRes.rows.length > 0 && reemItemsRes.rows.every((r) => r.status === "installed"),
    );
    let reemPayment1 = await latestPayment("JOB-2026-0004");
    check(
      "a pending 2,500.00 cash customer_payments row was created, received by Basel (DB)",
      reemPayment1 &&
        reemPayment1.amount === "2500.00" &&
        reemPayment1.method === "cash" &&
        reemPayment1.approval_status === "pending" &&
        reemPayment1.received_by_user_id === baselId,
    );
    check(
      "no cash_transactions row exists yet for the pending payment (DB) — financial-integrity: pending money is not real money",
      (await cashTransactionFor(reemPayment1.id, baselId, "2500.00")) === null,
    );

    console.log("Approve the pending payment as Mohammad (has approve_payment)...");
    await employeeCtx.clearCookies();
    await login(page, "0502222222", "password123"); // Mohammad
    await page.goto(`${BASE_URL}${reemHref}`, { waitUntil: "networkidle" });
    text = await page.innerText("body");
    check("Mohammad sees the pending payment awaiting approval", text.includes("بانتظار الاعتماد"));
    await page.click('button:has-text("اعتماد")');
    await page.waitForSelector('[role="alertdialog"]', { timeout: 10000 });
    await page.locator('[role="alertdialog"]').locator('button:has-text("اعتماد")').click();
    await page.waitForSelector("text=تم اعتماد الدفعة", { timeout: 10000 });
    await page.waitForTimeout(500);

    reemPayment1 = await latestPayment("JOB-2026-0004"); // same row, now decided
    check(
      "payment now approved, approved_by = Mohammad (DB)",
      reemPayment1.approval_status === "approved" && reemPayment1.approved_by_user_id === mohammadId,
    );
    const creditTx = await cashTransactionFor(reemPayment1.id, baselId, "2500.00");
    check(
      "approving credited Basel's own cash account with the exact amount (DB) — the real financial-integrity check",
      creditTx !== null,
    );
    text = await page.innerText("body");
    check(
      "job page's Paid figure updated (2,000 seeded deposit + 2,500 new = 4,500.00)",
      /4,?500\.00|₪4,?500/.test(text),
    );
    check(
      "job page's Remaining figure updated (6,500 sale price - 4,500 paid = 2,000.00)",
      /2,?000\.00|₪2,?000/.test(text),
    );

    // -----------------------------------------------------------------
    // Part F: rejection path — a second pending payment, rejected with a
    // reason; no cash_transactions row, reason retrievable from the DB
    // (the UI itself never displays the rejection reason text back).
    // -----------------------------------------------------------------
    console.log("\n--- Part F: reject a second pending payment ---");
    await employeeCtx.clearCookies();
    await login(page, "0503333333", "password123"); // Issam: collect_payment, not approve_payment
    await page.goto(`${BASE_URL}${reemHref}`, { waitUntil: "networkidle" });
    await page.click('button:has-text("إضافة دفعة")');
    dialog = page.locator('[role="dialog"]');
    await dialog.locator("#amount").fill("300");
    await dialog.locator('button:has-text("إضافة الدفعة")').click();
    await page.waitForSelector("text=تم تسجيل الدفعة", { timeout: 10000 });
    await page.waitForTimeout(400);

    let reemPayment2 = await latestPayment("JOB-2026-0004");
    check(
      "a second pending 300.00 cash payment created, received by Issam (DB)",
      reemPayment2 &&
        reemPayment2.amount === "300.00" &&
        reemPayment2.approval_status === "pending" &&
        reemPayment2.received_by_user_id === issamId,
    );

    await employeeCtx.clearCookies();
    await login(page, "0502222222", "password123"); // Mohammad
    await page.goto(`${BASE_URL}${reemHref}`, { waitUntil: "networkidle" });
    await page.click('button:has-text("رفض")');
    dialog = page.locator('[role="dialog"]');
    const rejectionReason = "لم يتم توثيق استلام المبلغ بشكل كافٍ.";
    await dialog.locator("#rejectionReason").fill(rejectionReason);
    await dialog.locator('button:has-text("تأكيد الرفض")').click();
    await page.waitForTimeout(700);

    reemPayment2 = await latestPayment("JOB-2026-0004");
    check("second payment now rejected (DB)", reemPayment2.approval_status === "rejected");
    check(
      "no cash_transactions row was created for the rejected payment (DB)",
      (await cashTransactionFor(reemPayment2.id, issamId, "300.00")) === null,
    );
    const approvalReqRes = await pool.query(
      `select rejection_reason from approval_requests where entity_type = 'customer_payment' and entity_id = $1`,
      [reemPayment2.id],
    );
    check(
      // Note: the UI never surfaces the rejection reason text anywhere on
      // the job page, so this is a DB-only check of approval_requests.
      "rejection reason is retrievable from approval_requests (DB) — UI does not surface this text itself",
      approvalReqRes.rows[0]?.rejection_reason === rejectionReason,
    );

    if (consoleErrors.length > 0) {
      console.log("\n--- Browser console errors seen during run ---");
      for (const e of consoleErrors) console.log("  ", e);
      failures++;
    }
  } catch (err) {
    console.error("VERIFICATION SCRIPT ERROR:", err);
    await page.screenshot({ path: "/tmp/phase7-error.png" }).catch(() => {});
    failures++;
  } finally {
    await pool.end();
    await browser.close();
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main();
