import { test, expect, createLeadJob, uniquePhone, uniqueLabel, demoUserId } from "./fixtures";

/**
 * Sprint 5 regression coverage: the free/self-hosted scheduled-notification
 * worker (src/server/scheduler/conditions.ts, triggered via
 * POST /api/internal/scheduler, src/app/api/internal/scheduler/route.ts).
 *
 * Exercises the internal endpoint directly, exactly the way the
 * `scheduler` docker-compose service calls it — not through Docker itself
 * (that's covered by a separate, manual `docker compose up` smoke test;
 * these tests run against the same local dev server every other e2e spec
 * in this suite uses). Two of the 7 scheduled trigger conditions are
 * exercised end-to-end as representative coverage of the shared
 * claim-and-notify mechanism every condition function uses identically;
 * the real point of these tests is proving that mechanism — race-safe
 * idempotency via `scheduled_reminders`' unique constraint — actually
 * works, not re-deriving all 7 conditions' individual business logic.
 */

const SCHEDULER_SECRET = process.env.SCHEDULER_SECRET;

test.describe("Sprint 5 — self-hosted scheduled-notification worker", () => {
  test.skip(
    !SCHEDULER_SECRET,
    "SCHEDULER_SECRET is not set in the environment running this test — see .env.example.",
  );

  test("a wrong secret is refused (401), never reaching the scheduler logic", async ({
    request,
  }) => {
    // Relative path — Playwright's `request` fixture resolves it against
    // playwright.config.ts's own configured baseURL (http://localhost:3000).
    const res = await request.post("/api/internal/scheduler", {
      headers: { "x-scheduler-secret": "definitely-not-the-real-secret" },
    });
    expect(res.status()).toBe(401);
  });

  test("an installation appointment starting soon notifies its assigned installer exactly once, even across two scheduler runs", async ({
    page,
    loginAs,
    db,
    request,
  }) => {
    const baselId = await demoUserId(db, "basel");
    await loginAs(page, "mohammad");
    const job = await createLeadJob(page, {
      customerName: uniqueLabel("عميل موعد تركيب"),
      customerPhone: uniquePhone(),
      title: "اختبار تذكير موعد التركيب",
    });

    // Direct SQL, not the scheduling dialog: the dialog's datetime-local
    // input is interpreted in the browser's own local timezone, which
    // would make "exactly 2 hours from now, in absolute UTC" fragile to
    // compute reliably through the UI — matching this suite's existing
    // convention of using direct SQL for setup the UI doesn't cleanly
    // support (see fixtures.ts's own doc comment).
    const scheduledStart = new Date(Date.now() + 2 * 60 * 60_000);
    const { rows: apptRows } = await db.query(
      `insert into appointments (job_id, type, scheduled_start, status)
       values ($1, 'installation', $2, 'scheduled')
       returning id`,
      [job.jobId, scheduledStart.toISOString()],
    );
    const appointmentId: string = apptRows[0].id;
    await db.query(
      `insert into appointment_assignees (appointment_id, user_id) values ($1, $2)`,
      [appointmentId, baselId],
    );

    const first = await request.post("/api/internal/scheduler", {
      headers: { "x-scheduler-secret": SCHEDULER_SECRET! },
    });
    expect(first.status()).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.ok).toBe(true);
    expect(firstBody.failures).toEqual([]);

    const { rows: afterFirst } = await db.query(
      `select id from notifications where type = 'installation_reminder' and user_id = $1 and related_entity_id = $2`,
      [baselId, job.jobId],
    );
    expect(afterFirst).toHaveLength(1);

    // A second run must NOT create a duplicate — this is the actual
    // "idempotent processing and duplicate prevention" requirement, and
    // the only way to prove it is to genuinely run the sweep twice.
    const second = await request.post("/api/internal/scheduler", {
      headers: { "x-scheduler-secret": SCHEDULER_SECRET! },
    });
    expect(second.status()).toBe(200);

    const { rows: afterSecond } = await db.query(
      `select id from notifications where type = 'installation_reminder' and user_id = $1 and related_entity_id = $2`,
      [baselId, job.jobId],
    );
    expect(afterSecond).toHaveLength(1); // still exactly one, not two
  });

  test("a repair open longer than the configured staleRepairDays threshold notifies its responsible technician", async ({
    page,
    loginAs,
    db,
    request,
  }) => {
    const baselId = await demoUserId(db, "basel");
    await loginAs(page, "mohammad");
    const job = await createLeadJob(page, {
      customerName: uniqueLabel("عميل إصلاح متأخر"),
      customerPhone: uniquePhone(),
      title: "اختبار تذكير إصلاح متأخر",
    });

    await page.click('button:has-text("الإبلاغ عن مشكلة")');
    const dialog = page.locator('[role="dialog"]');
    await dialog.locator("#problemDescription").fill("مشكلة اختبار — تذكير الإصلاح المتأخر");
    await dialog.locator("#responsibleUserId").click();
    await page.locator('[role="option"]:has-text("باسل")').click();
    await dialog.locator('button:has-text("تسجيل")').click();
    await page.waitForSelector("text=تم تسجيل الإصلاح", { timeout: 10_000 });

    const { rows: repairRows } = await db.query(
      `select id from repairs where job_id = $1`,
      [job.jobId],
    );
    expect(repairRows).toHaveLength(1);
    const repairId: string = repairRows[0].id;

    // Backdate it past the default staleRepairDays (5) threshold — the
    // create-repair dialog itself has no "date reported" field (it always
    // defaults to today server-side), so this is direct SQL too.
    await db.query(
      `update repairs set date_reported = (current_date - interval '6 days')::date where id = $1`,
      [repairId],
    );

    const res = await request.post("/api/internal/scheduler", {
      headers: { "x-scheduler-secret": SCHEDULER_SECRET! },
    });
    expect(res.status()).toBe(200);

    const { rows: notif } = await db.query(
      `select id from notifications where type = 'repair_stale_reminder' and user_id = $1 and related_entity_id = $2`,
      [baselId, job.jobId],
    );
    expect(notif).toHaveLength(1);
  });
});
