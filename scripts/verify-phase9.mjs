// Manual verification script for Phase 9 (repairs/Tikun, job close, vehicles
// and fuel logging — both backend halves and both UI halves: the standalone
// /repairs and /vehicles areas, the job-detail Repairs section + Close Job
// button, and My Day's Add Fuel quick action) — not part of the automated
// test suite. Drives a real headless browser against the seeded demo data,
// plus direct DB reads via the pg Pool for the status-transition,
// history-append-only, and permission-scoping checks that aren't fully
// observable from the UI. Finds jobs/vehicles by their stable seeded
// numbers/plates via the UI (never a hardcoded row id), same convention as
// verify-phase5/6/7/8.mjs, so it stays valid across a fresh `npm run
// db:seed`.
//
// Calls chromium.launch() with no executablePath override (this machine's
// locally-installed Playwright browser), same as verify-phase7/8.mjs.
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

async function vehicleHrefByPlate(page, plate) {
  await page.goto(`${BASE_URL}/vehicles`, { waitUntil: "networkidle" });
  const row = page.locator("tr", { hasText: plate });
  return row.locator("a").first().getAttribute("href");
}

function pad(n) {
  return String(n).padStart(2, "0");
}
function isoDateNDaysFromNow(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
/** Mirrors src/server/vehicles/actions.ts's own dayBefore() exactly, so
 * the DB assertion on a closed history row's endDate matches bit-for-bit. */
function dayBefore(dateStr) {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
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

  const usersRes = await pool.query(
    `select id, phone from users where phone in ('+972501111111','+972502222222','+972503333333','+972504444444')`,
  );
  const idByPhone = Object.fromEntries(usersRes.rows.map((r) => [r.phone, r.id]));
  const mohammadId = idByPhone["+972502222222"];
  const issamId = idByPhone["+972503333333"];
  const baselId = idByPhone["+972504444444"];

  // --- DB helpers -----------------------------------------------------
  async function jobIdByNumber(jobNumber) {
    const { rows } = await pool.query(`select id from jobs where job_number = $1`, [jobNumber]);
    return rows[0]?.id;
  }
  async function jobStatusKey(jobId) {
    const { rows } = await pool.query(
      `select js.key from jobs j join job_statuses js on js.id = j.status_id where j.id = $1`,
      [jobId],
    );
    return rows[0]?.key;
  }
  async function repairStatus(jobId, problemDescriptionLike) {
    const { rows } = await pool.query(
      `select status, resolved_at from repairs where job_id = $1 and problem_description like $2
       order by created_at desc limit 1`,
      [jobId, `%${problemDescriptionLike}%`],
    );
    return rows[0];
  }
  async function openRepairsSnapshot() {
    const { rows } = await pool.query(
      `select r.id, j.job_number, r.status from repairs r join jobs j on j.id = r.job_id
       where r.status in ('open','scheduled','in_progress')`,
    );
    return rows;
  }
  async function auditLogCount(action, entityId) {
    const { rows } = await pool.query(
      `select count(*)::int as c from audit_logs where action = $1 and entity_id = $2`,
      [action, entityId],
    );
    return rows[0].c;
  }
  async function vehicleIdByPlate(plate) {
    const { rows } = await pool.query(`select id from vehicles where plate_number = $1`, [plate]);
    return rows[0]?.id;
  }
  async function vehicleRow(vehicleId) {
    const { rows } = await pool.query(
      `select default_responsible_user_id, is_active from vehicles where id = $1`,
      [vehicleId],
    );
    return rows[0];
  }
  async function historyRows(vehicleId, userId) {
    // Dates cast to ::text so comparisons below are plain string equality
    // — never a JS Date reinterpreting a DATE column through a timezone.
    const { rows } = await pool.query(
      `select id, start_date::text as start_date, end_date::text as end_date
       from vehicle_responsibility_history
       where vehicle_id = $1 and user_id = $2 order by start_date desc`,
      [vehicleId, userId],
    );
    return rows;
  }
  async function latestFuelLog(vehicleId) {
    const { rows } = await pool.query(
      `select added_by_user_id, amount::text as amount, fuel_type, liters, mileage,
              receipt_photo_taken, logged_at
       from fuel_logs where vehicle_id = $1 order by created_at desc limit 1`,
      [vehicleId],
    );
    return rows[0];
  }
  async function vehicleCountByName(name) {
    const { rows } = await pool.query(`select count(*)::int as c from vehicles where name = $1`, [name]);
    return rows[0].c;
  }

  let monaHref, saraHref, nabilHref, karimHref, ahmadHref;
  let monaJobId, saraJobId, nabilJobId, karimJobId;
  let mercedesHref, deliveryVanHref;
  let mercedesId, deliveryVanId;

  try {
    console.log("=== Setup: locate seeded jobs + vehicles ===");
    await login(page, "0501111111", "password123"); // Amr (super-admin: only holder of MANAGE_VEHICLES besides seed data)
    monaHref = await jobHrefByNumber(page, "JOB-2026-0006");
    saraHref = await jobHrefByNumber(page, "JOB-2026-0002");
    nabilHref = await jobHrefByNumber(page, "JOB-2026-0005");
    karimHref = await jobHrefByNumber(page, "JOB-2026-0007");
    ahmadHref = await jobHrefByNumber(page, "JOB-2026-0001");
    monaJobId = await jobIdByNumber("JOB-2026-0006");
    saraJobId = await jobIdByNumber("JOB-2026-0002");
    nabilJobId = await jobIdByNumber("JOB-2026-0005");
    karimJobId = await jobIdByNumber("JOB-2026-0007");

    mercedesHref = await vehicleHrefByPlate(page, "12-345-67");
    deliveryVanHref = await vehicleHrefByPlate(page, "34-567-89");
    mercedesId = await vehicleIdByPlate("12-345-67");
    deliveryVanId = await vehicleIdByPlate("34-567-89");

    check("Mona's job (JOB-2026-0006) starts at ready_from_factory", (await jobStatusKey(monaJobId)) === "ready_from_factory");
    check("Sara's job (JOB-2026-0002) starts at waiting_for_pricing", (await jobStatusKey(saraJobId)) === "waiting_for_pricing");

    // -----------------------------------------------------------------
    // Part A: creating a repair advances the job's status — no
    // scheduledDate -> repair_needed, WITH a scheduledDate -> repair_scheduled.
    // -----------------------------------------------------------------
    console.log("\n--- Part A: create repairs -> job status advances (repair_needed / repair_scheduled) ---");
    const openRepairsBefore = await openRepairsSnapshot();

    await page.goto(`${BASE_URL}${monaHref}`, { waitUntil: "networkidle" });
    await page.click('button:has-text("الإبلاغ عن مشكلة")');
    let dialog = page.locator('[role="dialog"]');
    await dialog.locator("#problemDescription").fill("كسر بسيط في زاوية المرآة — اختبار فيز 9");
    await dialog.locator('button:has-text("تسجيل")').click();
    await page.waitForSelector("text=تم تسجيل الإصلاح", { timeout: 10000 });
    await page.waitForTimeout(400);

    check("Mona's job advanced to repair_needed after an OPEN repair (no scheduledDate) (DB)", (await jobStatusKey(monaJobId)) === "repair_needed");
    let monaRepair = await repairStatus(monaJobId, "اختبار فيز 9");
    check("Mona's new repair landed with status='open' (DB)", monaRepair?.status === "open");

    await page.goto(`${BASE_URL}${saraHref}`, { waitUntil: "networkidle" });
    await page.click('button:has-text("الإبلاغ عن مشكلة")');
    dialog = page.locator('[role="dialog"]');
    await dialog.locator("#problemDescription").fill("خدش على سطح الزجاج — اختبار فيز 9");
    await dialog.locator("#scheduledDate").fill(isoDateNDaysFromNow(4));
    await dialog.locator('button:has-text("تسجيل")').click();
    await page.waitForSelector("text=تم تسجيل الإصلاح", { timeout: 10000 });
    await page.waitForTimeout(400);

    check("Sara's job advanced to repair_scheduled after a SCHEDULED repair (DB)", (await jobStatusKey(saraJobId)) === "repair_scheduled");
    let saraRepair = await repairStatus(saraJobId, "اختبار فيز 9");
    check("Sara's new repair landed with status='scheduled' (DB)", saraRepair?.status === "scheduled");

    // -----------------------------------------------------------------
    // Part B: dashboard's open-repairs widget genuinely reflects reality
    // — both new repairs now appear.
    // -----------------------------------------------------------------
    console.log("\n--- Part B: dashboard open-repairs widget reflects the two new repairs ---");
    const openRepairsAfterCreate = await openRepairsSnapshot();
    check(
      "open-repairs count increased by exactly 2 after the two creations (DB)",
      openRepairsAfterCreate.length === openRepairsBefore.length + 2,
    );

    await page.goto(`${BASE_URL}/dashboard`, { waitUntil: "networkidle" });
    let dashboardText = await page.innerText("body");
    check("dashboard shows Mona's job in the open-repairs widget", dashboardText.includes("JOB-2026-0006"));
    check("dashboard shows Sara's job in the open-repairs widget", dashboardText.includes("JOB-2026-0002"));

    // -----------------------------------------------------------------
    // Part C: move Mona's repair through explicit status changes ONLY —
    // open -> scheduled -> in_progress -> resolved — never automatic, and
    // confirm resolving it (job still exactly repair_needed) advances the
    // job back to 'installed'.
    // -----------------------------------------------------------------
    console.log("\n--- Part C: move Mona's repair open -> scheduled -> in_progress -> resolved (explicit only) ---");
    await page.goto(`${BASE_URL}${monaHref}`, { waitUntil: "networkidle" });
    const repairsCard = page.locator('[data-slot="card"]', { hasText: "الإصلاحات" });
    const monaRepairRow = repairsCard.locator("li", { hasText: "اختبار فيز 9" });

    async function changeRepairStatus(label) {
      await monaRepairRow.locator('[role="combobox"]').click();
      await page.locator(`[role="option"]:has-text("${label}")`).click();
      await page.waitForSelector("text=تم تحديث حالة الإصلاح", { timeout: 10000 });
      await page.waitForTimeout(400);
    }

    await changeRepairStatus("مجدول");
    monaRepair = await repairStatus(monaJobId, "اختبار فيز 9");
    check("Mona's repair explicitly moved open -> scheduled (DB)", monaRepair?.status === "scheduled");
    check("job status untouched by a mere repair-status change, still repair_needed (DB)", (await jobStatusKey(monaJobId)) === "repair_needed");

    await changeRepairStatus("قيد التنفيذ");
    monaRepair = await repairStatus(monaJobId, "اختبار فيز 9");
    check("Mona's repair explicitly moved scheduled -> in_progress (DB)", monaRepair?.status === "in_progress");

    await changeRepairStatus("تم الحل");
    monaRepair = await repairStatus(monaJobId, "اختبار فيز 9");
    check("Mona's repair explicitly moved in_progress -> resolved, resolvedAt set (DB)", monaRepair?.status === "resolved" && monaRepair?.resolved_at !== null);
    check(
      "resolving it (job was still exactly repair_needed) advanced the job BACK to 'installed' (DB)",
      (await jobStatusKey(monaJobId)) === "installed",
    );

    // -----------------------------------------------------------------
    // Part D: the widget now excludes Mona's job specifically, while
    // Sara's (still 'scheduled') remains — a real diff, not a stale count.
    // -----------------------------------------------------------------
    console.log("\n--- Part D: resolved repair disappears from the OPEN widget specifically ---");
    const openRepairsAfterResolve = await openRepairsSnapshot();
    check(
      "open-repairs count back down by exactly 1 from the post-create total (DB)",
      openRepairsAfterResolve.length === openRepairsAfterCreate.length - 1,
    );
    check("Mona's resolved repair id is gone from the open set (DB)", !openRepairsAfterResolve.some((r) => r.job_number === "JOB-2026-0006"));
    check("Sara's still-scheduled repair remains in the open set (DB)", openRepairsAfterResolve.some((r) => r.job_number === "JOB-2026-0002"));

    await page.goto(`${BASE_URL}/dashboard`, { waitUntil: "networkidle" });
    dashboardText = await page.innerText("body");
    check("dashboard no longer lists Mona's job in the open-repairs widget", !dashboardText.includes("JOB-2026-0006"));
    check("dashboard still lists Sara's job (still scheduled) in the open-repairs widget", dashboardText.includes("JOB-2026-0002"));

    // -----------------------------------------------------------------
    // Part E: closeJobAction — rejected while an open repair exists
    // (Nabil, untouched seeded repair), rejected on outstanding balance
    // (Mona, now repair-free but salePriceTotal 1,800.00 with zero
    // payments), then succeeds on a job with neither blocker (Karim,
    // seeded fully paid + repair-free), and a second close attempt on the
    // now-terminal job is rejected cleanly — not double-processed.
    // -----------------------------------------------------------------
    console.log("\n--- Part E: closeJobAction — open-repair block, balance block, success, then reject a stale double-close ---");
    await page.goto(`${BASE_URL}${nabilHref}`, { waitUntil: "networkidle" });
    await page.click('button:has-text("إغلاق المهمة")');
    await page.locator('[role="alertdialog"]').locator('button:has-text("تأكيد الإغلاق")').click();
    await page.waitForSelector("text=لا يمكن إغلاق المهمة قبل حل جميع طلبات الإصلاح المفتوحة عليها", { timeout: 10000 });
    check("Nabil's job (untouched open repair) is still repair_needed, not completed (DB)", (await jobStatusKey(nabilJobId)) === "repair_needed");

    await page.goto(`${BASE_URL}${monaHref}`, { waitUntil: "networkidle" });
    await page.click('button:has-text("إغلاق المهمة")');
    await page.locator('[role="alertdialog"]').locator('button:has-text("تأكيد الإغلاق")').click();
    await page.waitForSelector("text=لا يمكن إغلاق المهمة قبل تحصيل كامل المبلغ المستحق", { timeout: 10000 });
    check("Mona's job (repair-free but 1,800.00 owed) is still installed, not completed (DB)", (await jobStatusKey(monaJobId)) === "installed");

    // A second (stale) context loads Karim's job page now, while it's
    // still open/repair-free/fully-paid — its Close button stays in the
    // stale DOM even after the primary context closes the job (same
    // double-decide race pattern verify-phase8.mjs Part C exercises on
    // finalize-commission).
    const staleCtx = await browser.newContext({ locale: "ar" });
    const stalePage = await staleCtx.newPage();
    await login(stalePage, "0501111111", "password123"); // Amr, second session
    await stalePage.goto(`${BASE_URL}${karimHref}`, { waitUntil: "networkidle" });

    await page.goto(`${BASE_URL}${karimHref}`, { waitUntil: "networkidle" });
    check("Karim's job (fully paid, repair-free) starts installed, non-terminal", (await jobStatusKey(karimJobId)) === "installed");
    await page.click('button:has-text("إغلاق المهمة")');
    await page.locator('[role="alertdialog"]').locator('button:has-text("تأكيد الإغلاق")').click();
    await page.waitForSelector("text=تم إغلاق المهمة", { timeout: 10000 });
    check("Karim's job is now completed (DB)", (await jobStatusKey(karimJobId)) === "completed");
    check("exactly one job.close audit row for Karim's job so far (DB)", (await auditLogCount("job.close", karimJobId)) === 1);

    await stalePage.click('button:has-text("إغلاق المهمة")');
    await stalePage.locator('[role="alertdialog"]').locator('button:has-text("تأكيد الإغلاق")').click();
    await stalePage.waitForSelector("text=هذه المهمة مغلقة بالفعل", { timeout: 10000 });
    check("the stale second close attempt was rejected — job.close audit rows still exactly 1, not 2 (DB)", (await auditLogCount("job.close", karimJobId)) === 1);
    check("Karim's job status is still completed, unchanged by the rejected second call (DB)", (await jobStatusKey(karimJobId)) === "completed");
    await staleCtx.close();

    // -----------------------------------------------------------------
    // Part F: creating a vehicle with a duplicate plate number is
    // rejected with a clear Arabic message, not a raw DB error.
    // -----------------------------------------------------------------
    console.log("\n--- Part F: duplicate plate number rejected cleanly ---");
    const vehicleCountBefore = await vehicleCountByName("مركبة اختبار فيز 9");
    await page.goto(`${BASE_URL}/vehicles`, { waitUntil: "networkidle" });
    await page.click('button:has-text("إضافة مركبة")');
    dialog = page.locator('[role="dialog"]');
    await dialog.locator("#name").fill("مركبة اختبار فيز 9");
    await dialog.locator("#plateNumber").fill("12-345-67"); // Mercedes's plate, seeded
    await dialog.locator("#fuelType").click();
    await page.locator('[role="option"]:has-text("بنزين")').click();
    await dialog.locator('button:has-text("إضافة المركبة")').click();
    await page.waitForSelector("text=رقم اللوحة مستخدم بالفعل لمركبة أخرى", { timeout: 10000 });
    check("the duplicate-plate error is the clean Arabic message, not a raw DB error", (await dialog.locator('[role="alert"]').innerText()).includes("رقم اللوحة مستخدم بالفعل"));
    check("dialog stayed open after the rejection (no false success)", (await page.locator('[role="dialog"]').count()) === 1);
    check("no vehicle row was actually created (DB)", (await vehicleCountByName("مركبة اختبار فيز 9")) === vehicleCountBefore);
    await dialog.locator('button:has-text("إلغاء")').click();

    // -----------------------------------------------------------------
    // Part G: assign vehicle responsibility from Basel to Mohammad on the
    // Delivery Van — the old row is CLOSED (endDate set, never deleted or
    // overwritten), a NEW open row for the new user is inserted, and
    // vehicles.defaultResponsibleUserId is synced (section 57).
    // -----------------------------------------------------------------
    console.log("\n--- Part G: assign vehicle responsibility Basel -> Mohammad (history preserved, never overwritten) ---");
    const baselOpenRowsBefore = (await historyRows(deliveryVanId, baselId)).filter((r) => r.end_date === null);
    check("Delivery Van starts with exactly one OPEN history row for Basel (DB)", baselOpenRowsBefore.length === 1);

    await page.goto(`${BASE_URL}${deliveryVanHref}`, { waitUntil: "networkidle" });
    await page.click('button:has-text("تغيير المسؤول")');
    dialog = page.locator('[role="dialog"]');
    await dialog.locator("#userId").click();
    await page.locator('[role="option"]:has-text("محمد")').click();
    await dialog.locator('button:has-text("تعيين")').click();
    await page.waitForSelector('[role="dialog"]', { state: "detached", timeout: 10000 });

    const today = isoDateNDaysFromNow(0);
    const baselRowsAfter = await historyRows(deliveryVanId, baselId);
    const closedBaselRow = baselRowsAfter.find((r) => r.id === baselOpenRowsBefore[0].id);
    check(
      "Basel's OLD history row is CLOSED (endDate = the day before Mohammad's start), never deleted (DB)",
      closedBaselRow && closedBaselRow.end_date === dayBefore(today),
    );
    const mohammadRowsAfter = (await historyRows(deliveryVanId, mohammadId)).filter((r) => r.end_date === null);
    check(
      "a NEW open history row for Mohammad now exists (startDate = today, endDate null) (DB)",
      mohammadRowsAfter.length === 1 && mohammadRowsAfter[0].start_date === today,
    );
    const deliveryVanAfter = await vehicleRow(deliveryVanId);
    check("vehicles.defaultResponsibleUserId now points at Mohammad (DB)", deliveryVanAfter?.default_responsible_user_id === mohammadId);

    // -----------------------------------------------------------------
    // Part H: adding fuel — Issam (defaultVehicleId = Mercedes, seeded)
    // sees the fuel form pre-filled to his default vehicle, and submitting
    // with only Fuel Type + Amount filled (everything else left empty)
    // succeeds, stamping addedByUserId/loggedAt itself.
    // -----------------------------------------------------------------
    console.log("\n--- Part H: add fuel — defaults to Issam's own vehicle, minimum-input entry ---");
    await employeeCtx.clearCookies();
    await login(page, "0503333333", "password123"); // Issam
    await page.goto(`${BASE_URL}/my-day`, { waitUntil: "networkidle" });
    await page.click('button:has-text("إضافة وقود")');
    dialog = page.locator('[role="dialog"]');
    const vehicleTriggerText = await dialog.locator("#vehicleId").innerText();
    check("the fuel form's Vehicle field defaults to Issam's own defaultVehicleId (Mercedes)", vehicleTriggerText.includes("Mercedes") || vehicleTriggerText.includes("12-345-67"));

    const beforeSubmit = new Date();
    await dialog.locator("#fuelType").click();
    await page.locator('[role="option"]:has-text("ديزل")').click();
    await dialog.locator("#amount").fill("85");
    await dialog.locator('button:has-text("تسجيل الوقود")').click();
    await page.waitForSelector("text=تم تسجيل الوقود", { timeout: 10000 });
    await page.waitForTimeout(400);

    const newFuelLog = await latestFuelLog(mercedesId);
    check("new fuel log's addedByUserId is Issam (the current user), never asked for (DB)", newFuelLog?.added_by_user_id === issamId);
    check("new fuel log amount=85.00, fuelType=diesel, exactly as entered (DB)", newFuelLog?.amount === "85.00" && newFuelLog?.fuel_type === "diesel");
    check("liters/mileage genuinely left null — nothing the user didn't type was invented (DB)", newFuelLog?.liters === null && newFuelLog?.mileage === null);
    check(
      "loggedAt is server-stamped to 'now', not asked for on the form (DB)",
      newFuelLog?.logged_at instanceof Date && Math.abs(newFuelLog.logged_at.getTime() - beforeSubmit.getTime()) < 60000,
    );

    // -----------------------------------------------------------------
    // Part I: permission-denial DOM-absence checks (Basel) — has ADD_FUEL
    // but lacks MANAGE_VEHICLES. Basel now also holds CREATE_REPAIR (Phase
    // 9 follow-up fix: Basel is the seeded responsibleUserId on two open
    // repairs, and previously had no way anywhere in the app to see or
    // update them — see the repairs section/list checks just below, which
    // now assert presence/access instead of absence/Forbidden).
    // -----------------------------------------------------------------
    console.log("\n--- Part I: permission-denial DOM-absence checks (Basel) ---");
    await employeeCtx.clearCookies();
    await login(page, "0504444444", "password123"); // Basel
    await page.goto(`${BASE_URL}${ahmadHref}`, { waitUntil: "networkidle" }); // Basel is involved (measured + assigned)
    let text = await page.innerText("body");
    check("Basel can open Ahmad's job (still involved)", text.includes("JOB-2026-0001"));
    check(
      "the Repairs section IS present for Basel (now holds CREATE_REPAIR) (DOM)",
      (await page.locator('[data-slot="card"]', { hasText: "الإصلاحات" }).count()) === 1,
    );

    await page.goto(`${BASE_URL}/repairs`, { waitUntil: "networkidle" });
    text = await page.innerText("body");
    check("Basel navigating directly to /repairs sees the list, not Forbidden", !text.includes("لا تملك صلاحية الوصول لهذه الصفحة"));

    await page.goto(`${BASE_URL}/vehicles`, { waitUntil: "networkidle" });
    text = await page.innerText("body");
    check("Basel (has ADD_FUEL) CAN view the vehicle list", text.includes("34-567-89") || text.includes("12-345-67"));
    check("...but has no 'إضافة مركبة' trigger (lacks MANAGE_VEHICLES)", (await page.locator('button:has-text("إضافة مركبة")').count()) === 0);

    await page.goto(`${BASE_URL}${mercedesHref}`, { waitUntil: "networkidle" });
    check("Basel CAN see the Add Fuel trigger on a vehicle's own page (has ADD_FUEL)", (await page.locator('button:has-text("إضافة وقود")').count()) === 1);
    check("...but no 'تعديل' (edit) trigger (lacks MANAGE_VEHICLES)", (await page.locator('button:has-text("تعديل")').count()) === 0);
    check("...and no 'تغيير المسؤول' (change responsibility) trigger (lacks MANAGE_VEHICLES)", (await page.locator('button:has-text("تغيير المسؤول")').count()) === 0);

    if (consoleErrors.length > 0) {
      console.log("\n--- Browser console errors seen during run ---");
      for (const e of consoleErrors) console.log("  ", e);
      failures++;
    }
  } catch (err) {
    console.error("VERIFICATION SCRIPT ERROR:", err);
    await page.screenshot({ path: "/tmp/phase9-error.png" }).catch(() => {});
    failures++;
  } finally {
    await pool.end();
    await browser.close();
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main();
