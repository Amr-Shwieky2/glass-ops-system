// Manual verification script for two build-stage features that landed in
// parallel: the cash-drawer audit view (finance/technicians/[userId]) and
// installer UX (arrived-at-site + field notes on My Day) — not part of the
// automated test suite. Drives a real headless browser against the seeded
// demo data, plus direct DB reads/writes via the pg Pool for the
// financial-integrity and race-safety checks that aren't fully observable
// from the UI. Finds jobs by their stable seeded numbers via the UI (never
// a hardcoded row id), same convention as verify-phase7.mjs/verify-phase8.mjs,
// so it stays valid across a fresh `npm run db:seed`.
//
// Same convention as the other verify-phase*.mjs scripts: chromium.launch()
// with no executablePath override (uses Playwright's locally-installed
// browser), a plain check()/failures counter, and a final pass/fail summary
// with a non-zero exit code on failure.
import "dotenv/config";
import { randomUUID } from "node:crypto";
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

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}
function dateOnly(d) {
  return d.toISOString().slice(0, 10);
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

  // Seeded user ids, fetched once via direct DB query.
  const usersRes = await pool.query(
    `select id, phone from users where phone in ('+972501111111','+972502222222','+972503333333','+972504444444')`,
  );
  const idByPhone = Object.fromEntries(usersRes.rows.map((r) => [r.phone, r.id]));
  const amrId = idByPhone["+972501111111"];
  const mohammadId = idByPhone["+972502222222"];

  async function appointment(jobNumber, type) {
    const { rows } = await pool.query(
      `select a.id, a.status, a.arrived_at from appointments a join jobs j on j.id = a.job_id
       where j.job_number = $1 and a.type = $2 order by a.scheduled_start desc limit 1`,
      [jobNumber, type],
    );
    return rows[0];
  }
  async function jobIdAndNotes(jobNumber) {
    const { rows } = await pool.query(`select id, notes from jobs where job_number = $1`, [jobNumber]);
    return rows[0];
  }
  async function cashAccountIdForUser(userId) {
    const { rows } = await pool.query(`select id from cash_accounts where owner_user_id = $1`, [userId]);
    return rows[0]?.id;
  }

  try {
    // ===================================================================
    // Part A: cash-drawer audit view — date filter actually narrows
    // results (create two cash_transactions on very different dates,
    // filter to a range that only covers one, confirm only that one
    // shows).
    // ===================================================================
    console.log("=== Part A: cash-drawer audit date filter ===");
    const mohammadCashId = await cashAccountIdForUser(mohammadId);
    check("Mohammad has a cash account (DB, seeded)", !!mohammadCashId);

    const oldMarker = `MARKER-OLD-${randomUUID().slice(0, 8)}`;
    const newMarker = `MARKER-NEW-${randomUUID().slice(0, 8)}`;
    const oldDate = daysAgo(90);
    const newDate = new Date(); // today

    await pool.query(
      `insert into cash_transactions (cash_account_id, direction, amount, source_type, notes, created_by_user_id, created_at)
       values ($1, 'in', '111.00', 'adjustment', $2, $3, $4)`,
      [mohammadCashId, oldMarker, amrId, oldDate],
    );
    await pool.query(
      `insert into cash_transactions (cash_account_id, direction, amount, source_type, notes, created_by_user_id, created_at)
       values ($1, 'in', '222.00', 'adjustment', $2, $3, $4)`,
      [mohammadCashId, newMarker, amrId, newDate],
    );

    await login(page, "0501111111", "password123"); // Amr: VIEW_TECHNICIAN_BALANCES

    await page.goto(`${BASE_URL}/finance/technicians/${mohammadId}`, { waitUntil: "networkidle" });
    let text = await page.innerText("body");
    check("unfiltered cash drawer shows the old-dated transaction", text.includes(oldMarker));
    check("unfiltered cash drawer shows the new-dated (today) transaction", text.includes(newMarker));

    // Filter to today only -> old transaction must disappear, new one stays.
    await page.goto(
      `${BASE_URL}/finance/technicians/${mohammadId}?dateFrom=${dateOnly(newDate)}&dateTo=${dateOnly(newDate)}`,
      { waitUntil: "networkidle" },
    );
    text = await page.innerText("body");
    check("date filter (today only): today's transaction is shown", text.includes(newMarker));
    check("date filter (today only): the 90-day-old transaction is correctly excluded", !text.includes(oldMarker));

    // Filter to a range covering only the old transaction -> inverse check.
    await page.goto(
      `${BASE_URL}/finance/technicians/${mohammadId}?dateFrom=${dateOnly(daysAgo(95))}&dateTo=${dateOnly(daysAgo(85))}`,
      { waitUntil: "networkidle" },
    );
    text = await page.innerText("body");
    check("date filter (90 days ago range): the old transaction is shown", text.includes(oldMarker));
    check("date filter (90 days ago range): today's transaction is correctly excluded", !text.includes(newMarker));

    // A range that covers neither -> empty-state message, matching the
    // page's own "no matching results" copy for an active filter.
    await page.goto(
      `${BASE_URL}/finance/technicians/${mohammadId}?dateFrom=${dateOnly(daysAgo(200))}&dateTo=${dateOnly(daysAgo(190))}`,
      { waitUntil: "networkidle" },
    );
    text = await page.innerText("body");
    check(
      "date filter (no matches): neither marker shown, and the 'no matching results' empty state renders",
      !text.includes(oldMarker) && !text.includes(newMarker) && text.includes("لا توجد نتائج مطابقة"),
    );

    // ===================================================================
    // Part B: installer UX — a technician marks their OWN appointment
    // arrived (Basel on Sara's today follow-up measurement,
    // JOB-2026-0002), then a second attempt on the same appointment is
    // rejected (race-safety, same double-decide pattern as
    // verify-phase7.mjs Part D / verify-phase8.mjs Part C / decide.ts).
    // ===================================================================
    console.log("\n=== Part B: mark appointment arrived + race-safety double-tap ===");
    const saraAppt = await appointment("JOB-2026-0002", "measurement");
    check("Sara's follow-up measurement appointment starts out 'scheduled' (DB, seeded)", saraAppt?.status === "scheduled");

    // Two independent, already-logged-in Basel sessions viewing the SAME
    // My Day state — mirrors verify-phase8.mjs's stale-second-context
    // pattern for the double-decide race.
    const baselCtxA = await browser.newContext({ locale: "ar" });
    const baselPageA = await baselCtxA.newPage();
    await login(baselPageA, "0504444444", "password123");
    await baselPageA.goto(`${BASE_URL}/my-day`, { waitUntil: "networkidle" });

    const baselCtxB = await browser.newContext({ locale: "ar" });
    const baselPageB = await baselCtxB.newPage();
    await login(baselPageB, "0504444444", "password123");
    await baselPageB.goto(`${BASE_URL}/my-day`, { waitUntil: "networkidle" });

    const saraCardA = baselPageA.locator('[data-slot="card"]', { hasText: "JOB-2026-0002" });
    check("Basel's My Day (session A) shows the 'وصلت الموقع' button for Sara's job", (await saraCardA.locator('button:has-text("وصلت الموقع")').count()) === 1);
    await saraCardA.locator('button:has-text("وصلت الموقع")').click();
    await baselPageA.waitForSelector("text=وصلت الموقع الساعة", { timeout: 10000 });
    await baselPageA.waitForTimeout(400);

    let saraApptAfter = await appointment("JOB-2026-0002", "measurement");
    check("appointment status flipped to 'arrived' (DB)", saraApptAfter?.status === "arrived");
    check("arrived_at was set (DB)", !!saraApptAfter?.arrived_at);
    const firstArrivedAt = saraApptAfter.arrived_at;

    // Session B's DOM is stale (still shows the button from before A's
    // click) — click it anyway to exercise the race-safe conditional
    // UPDATE ... WHERE status = 'scheduled'.
    const saraCardB = baselPageB.locator('[data-slot="card"]', { hasText: "JOB-2026-0002" });
    await saraCardB.locator('button:has-text("وصلت الموقع")').click();
    await baselPageB.waitForSelector("text=تم تحديث حالة هذا الموعد بالفعل", { timeout: 10000 });

    saraApptAfter = await appointment("JOB-2026-0002", "measurement");
    check(
      "second (stale, double-tap) attempt was rejected — arrived_at unchanged, not overwritten (DB) — race-safety",
      saraApptAfter?.status === "arrived" && saraApptAfter.arrived_at.getTime() === firstArrivedAt.getTime(),
    );

    await baselCtxA.close();
    await baselCtxB.close();

    // ===================================================================
    // Part C: a non-assignee cannot mark someone else's appointment
    // arrived. My Day (getMyDayAppointments) is scoped server-side to the
    // caller's own appointment_assignees rows regardless of permissions,
    // and no other screen in the app renders an arrival trigger at all —
    // so the observable surface for "cannot" is that the appointment/job
    // never appears in a non-assignee's My Day in the first place, the
    // same DOM-absence-for-permission-denial pattern verify-phase7.mjs
    // Part D uses (there for a missing button; here for the entire card).
    // Mohammad is not seeded as an assignee on any of today's
    // appointments, including Sara's job.
    // ===================================================================
    console.log("\n=== Part C: non-assignee cannot see/act on someone else's appointment ===");
    await employeeCtx.clearCookies();
    await login(page, "0502222222", "password123"); // Mohammad
    await page.goto(`${BASE_URL}/my-day`, { waitUntil: "networkidle" });
    text = await page.innerText("body");
    check(
      "Mohammad (not an assignee on Sara's appointment) has no card for JOB-2026-0002 in his My Day at all — no way to reach the arrival trigger",
      !text.includes("JOB-2026-0002"),
    );
    check(
      "Mohammad also has no card for Reem's installation (JOB-2026-0004) — not assigned there either",
      !text.includes("JOB-2026-0004"),
    );

    // ===================================================================
    // Part D: field notes append rather than overwrite — add two notes on
    // Reem's job (Basel is one of its installation assignees) and confirm
    // BOTH are still visible afterward, not just the latest.
    // ===================================================================
    console.log("\n=== Part D: field notes preserve prior notes (append, not overwrite) ===");
    const reemBefore = await jobIdAndNotes("JOB-2026-0004");
    check("Reem's job starts with no notes yet (DB, seeded)", !reemBefore?.notes);

    await employeeCtx.clearCookies();
    await login(page, "0504444444", "password123"); // Basel
    await page.goto(`${BASE_URL}/my-day`, { waitUntil: "networkidle" });
    const reemCard = page.locator('[data-slot="card"]', { hasText: "JOB-2026-0004" });

    const note1 = `ملاحظة ميدانية أولى ${randomUUID().slice(0, 8)}: تم فحص الزجاج، لا يوجد كسر.`;
    await reemCard.locator('button:has-text("رفع ملاحظة")').click();
    let dialog = page.locator('[role="dialog"]');
    await dialog.locator("#note").fill(note1);
    await dialog.locator('button:has-text("حفظ")').click();
    await page.waitForSelector("text=تمت إضافة الملاحظة", { timeout: 10000 });
    await page.waitForTimeout(400);

    let reemAfterFirst = await jobIdAndNotes("JOB-2026-0004");
    check("first note landed in jobs.notes (DB)", reemAfterFirst?.notes?.includes(note1));

    const note2 = `ملاحظة ميدانية ثانية ${randomUUID().slice(0, 8)}: العميل طلب تلميع إضافي.`;
    await reemCard.locator('button:has-text("رفع ملاحظة")').click();
    dialog = page.locator('[role="dialog"]');
    await dialog.locator("#note").fill(note2);
    await dialog.locator('button:has-text("حفظ")').click();
    await page.waitForSelector("text=تمت إضافة الملاحظة", { timeout: 10000 });
    await page.waitForTimeout(400);

    const reemAfterSecond = await jobIdAndNotes("JOB-2026-0004");
    check(
      "BOTH notes present in jobs.notes after the second add (DB) — appended, not overwritten",
      reemAfterSecond?.notes?.includes(note1) && reemAfterSecond?.notes?.includes(note2),
    );

    const reemHref = await jobHrefByNumber(page, "JOB-2026-0004");
    await page.goto(`${BASE_URL}${reemHref}`, { waitUntil: "networkidle" });
    text = await page.innerText("body");
    check("job detail page renders the FIRST note's text", text.includes(note1));
    check("job detail page ALSO renders the SECOND note's text (not just the latest)", text.includes(note2));

    // Empty-note validation still rejects (server-side; dialog form has
    // noValidate so this exercises AddFieldNoteSchema, not the browser).
    await page.goto(`${BASE_URL}/my-day`, { waitUntil: "networkidle" });
    await reemCard.locator('button:has-text("رفع ملاحظة")').click();
    dialog = page.locator('[role="dialog"]');
    await dialog.locator('button:has-text("حفظ")').click();
    // Wait on the actual error text, not just the [role="alert"] element's
    // presence — the element can attach a beat before React commits its
    // text child, which made this a flaky false-negative when checked via
    // waitForSelector('[role="alert"]') followed immediately by innerText().
    await page.waitForSelector("text=نص الملاحظة مطلوب", { timeout: 10000 });
    text = await dialog.innerText();
    check("empty note is rejected server-side with the expected Arabic message", text.includes("نص الملاحظة مطلوب"));
    await dialog.locator('button:has-text("إلغاء")').click();

    if (consoleErrors.length > 0) {
      console.log("\n--- Browser console errors seen during run ---");
      for (const e of consoleErrors) console.log("  ", e);
      failures++;
    }
  } catch (err) {
    console.error("VERIFICATION SCRIPT ERROR:", err);
    await page.screenshot({ path: "/tmp/verify-req-cash-installer-error.png" }).catch(() => {});
    failures++;
  } finally {
    await pool.end();
    await browser.close();
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main();
