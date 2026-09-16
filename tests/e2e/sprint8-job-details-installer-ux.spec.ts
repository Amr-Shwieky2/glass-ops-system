import {
  test,
  expect,
  createLeadJob,
  uniquePhone,
  uniqueLabel,
  demoUserId,
  grantPermission,
  revokePermission,
  DEMO_USERS,
} from "./fixtures";

/**
 * Sprint 8 regression coverage: Job Details + installer UX completion pass.
 *
 * - The "إكمال التركيب" (complete installation) note and photo checkbox
 *   used to be lost unless a payment was collected in the same submission
 *   (note) or were never a real column at all (photo) — both now persist
 *   unconditionally to appointments.notes / appointments.photo_taken.
 * - A standalone "جمع دفعة" (collect payment) quick action on My Day,
 *   independent of the completion dialog — and the job-visibility gap it
 *   surfaced: a technician scheduled onto a job only via "جدولة موعد"
 *   (appointment_assignees), never separately run through "تعيين فني"
 *   (job_assignments), which addPaymentAction's assertJobVisible alone
 *   would otherwise reject even though My Day itself links them to this
 *   exact job (fixed in src/server/payments/actions.ts, alongside the
 *   same fix for the job detail page's own Forbidden gate).
 * - job.notes is now gated behind the same financial-visibility
 *   permissions as every other management-only figure on the job page,
 *   instead of rendering to any viewer who could open the page at all.
 */

test.describe("Sprint 8 — installation completion persistence, standalone payment collection, job.notes gating", () => {
  test("completing an installation persists the note and the photo checkbox as real columns, with no payment collected — and a technician assigned only via the appointment (not job_assignments) can still open the job and act on it", async ({
    page,
    loginAs,
    db,
  }) => {
    await loginAs(page, "mohammad");
    const job = await createLeadJob(page, {
      customerName: uniqueLabel("عميل إكمال التركيب"),
      customerPhone: uniquePhone(),
      title: "اختبار إكمال التركيب بدون دفعة",
    });

    const baselId = await demoUserId(db, "basel");
    // Scheduled directly via SQL (matches this suite's own convention,
    // see fixtures.ts / sprint5-scheduler.spec.ts) rather than the
    // scheduling dialog — and deliberately WITHOUT touching
    // job_assignments, to also exercise the appointment-only visibility
    // path below.
    const { rows: apptRows } = await db.query(
      `insert into appointments (job_id, type, scheduled_start, status)
       values ($1, 'installation', now(), 'scheduled') returning id`,
      [job.jobId],
    );
    const appointmentId: string = apptRows[0].id;
    await db.query(
      `insert into appointment_assignees (appointment_id, user_id) values ($1, $2)`,
      [appointmentId, baselId],
    );
    const { rows: assignmentCheck } = await db.query(
      `select count(*)::int as c from job_assignments where job_id = $1 and user_id = $2`,
      [job.jobId, baselId],
    );
    expect(assignmentCheck[0].c).toBe(0); // appointment-only, on purpose

    await loginAs(page, "basel");

    // Basel is NOT in job_assignments for this job, only appointment_assignees
    // — "فتح المهمة" from My Day must still open the real job page, not
    // Forbidden (the same gap fixed for addPaymentAction below).
    await page.goto(job.href, { waitUntil: "networkidle" });
    await expect(page.locator("h1", { hasText: job.jobNumber })).toBeVisible();
    await expect(page.locator("text=هذه المهمة غير مسندة إليك")).toHaveCount(0);

    await page.goto("/my-day", { waitUntil: "networkidle" });
    const card = page.locator('[data-slot="card"]', { hasText: job.jobNumber });
    await card.locator('button:has-text("إكمال التركيب")').click();
    const dialog = page.locator('[role="dialog"]');
    await dialog.locator("#photoTaken").click();
    const noteText = "خدش بسيط لوحظ على إطار النافذة، تم توثيقه";
    await dialog.locator("#note").fill(noteText);
    // paymentCollected switch left OFF on purpose.
    await dialog.locator('button:has-text("إكمال التركيب")').last().click();
    await page.waitForSelector("text=تم إكمال التركيب", { timeout: 10_000 });
    await page.waitForTimeout(500);

    const { rows } = await db.query(
      `select status, photo_taken, notes from appointments where id = $1`,
      [appointmentId],
    );
    expect(rows[0].status).toBe("completed");
    expect(rows[0].photo_taken).toBe(true);
    expect(rows[0].notes).toContain(noteText);
    expect(rows[0].notes).toContain("[إكمال التركيب]");

    // No payment was collected in this submission — confirm none exists.
    const { rows: paymentRows } = await db.query(
      `select count(*)::int as c from customer_payments where job_id = $1`,
      [job.jobId],
    );
    expect(paymentRows[0].c).toBe(0);
  });

  test("the standalone \"جمع دفعة\" quick action on My Day records a payment independent of installation completion, even for a technician assigned only via the appointment", async ({
    page,
    loginAs,
    db,
  }) => {
    await loginAs(page, "mohammad");
    const job = await createLeadJob(page, {
      customerName: uniqueLabel("عميل جمع دفعة مستقل"),
      customerPhone: uniquePhone(),
      title: "اختبار جمع دفعة من يومي",
    });

    const baselId = await demoUserId(db, "basel");
    const { rows: apptRows } = await db.query(
      `insert into appointments (job_id, type, scheduled_start, status)
       values ($1, 'installation', now(), 'scheduled') returning id`,
      [job.jobId],
    );
    const appointmentId: string = apptRows[0].id;
    await db.query(
      `insert into appointment_assignees (appointment_id, user_id) values ($1, $2)`,
      [appointmentId, baselId],
    );

    await loginAs(page, "basel");
    await page.goto("/my-day", { waitUntil: "networkidle" });
    const card = page.locator('[data-slot="card"]', { hasText: job.jobNumber });
    await card.locator('button:has-text("جمع دفعة")').click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog.locator("text=إضافة دفعة عميل")).toBeVisible();
    await dialog.locator("#amount").fill("650");
    await dialog.locator('button:has-text("إضافة الدفعة")').click();
    await page.waitForSelector("text=تم تسجيل الدفعة", { timeout: 10_000 });
    await page.waitForTimeout(500);

    const { rows: paymentRows } = await db.query(
      `select amount, approval_status, received_by_user_id from customer_payments
       where job_id = $1 order by created_at desc limit 1`,
      [job.jobId],
    );
    expect(paymentRows).toHaveLength(1);
    expect(paymentRows[0].amount).toBe("650.00");
    expect(paymentRows[0].received_by_user_id).toBe(baselId);
    expect(paymentRows[0].approval_status).toBe("pending"); // Basel lacks APPROVE_PAYMENT

    // The appointment itself is untouched — proves this action is genuinely
    // independent of the completion flow, not a side effect of it.
    const { rows: apptCheck } = await db.query(
      `select status from appointments where id = $1`,
      [appointmentId],
    );
    expect(apptCheck[0].status).toBe("scheduled");
  });

  test("job.notes is visible to a financial viewer but hidden from an installer with no financial-visibility permission, even though both can open the job page", async ({
    page,
    loginAs,
    db,
  }) => {
    const secretNote = uniqueLabel("ملاحظة داخلية سرية");

    await loginAs(page, "mohammad"); // holds VIEW_SALE_PRICE
    const job = await createLeadJob(page, {
      customerName: uniqueLabel("عميل ملاحظات المهمة"),
      customerPhone: uniquePhone(),
      title: "اختبار إخفاء ملاحظات المهمة",
      notes: secretNote,
    });

    let text = await page.innerText("main");
    expect(text).toContain(secretNote);

    // Make Basel genuinely able to open the page (job_assignments), the
    // same "involved but no financial permission" persona Sprint 6 already
    // established for the customer page.
    await page.click('button:has-text("تعيين فني")');
    const assignDialog = page.locator('[role="dialog"]');
    await assignDialog.locator("#userId").click();
    await page.locator(`[role="option"]:has-text("${DEMO_USERS.basel.name}")`).click();
    await assignDialog.locator('button:has-text("تعيين"):not(:has-text("فني"))').click();
    await page.waitForTimeout(500);

    await loginAs(page, "basel");
    await page.goto(job.href, { waitUntil: "networkidle" });
    await expect(page.locator("h1", { hasText: job.jobNumber })).toBeVisible();
    text = await page.innerText("main");
    expect(text).not.toContain(secretNote);

    // Confirm this is a genuine permission gate, not a coincidence of
    // Basel's own permission set: granting VIEW_JOB_COSTS reveals it.
    const baselId = await demoUserId(db, "basel");
    await grantPermission(db, baselId, "view_job_costs");
    await page.reload({ waitUntil: "networkidle" });
    text = await page.innerText("main");
    expect(text).toContain(secretNote);

    await revokePermission(db, baselId, "view_job_costs");
  });

  test("the calendar renders with the real Arabic locale module (not just the manually-overridden button labels) and shows assignee names + location on each event, not just the bare title", async ({
    page,
    loginAs,
    db,
  }) => {
    await loginAs(page, "mohammad");
    const uniqueLocation = uniqueLabel("شارع اختبار التقويم");
    const job = await createLeadJob(page, {
      customerName: uniqueLabel("عميل التقويم"),
      customerPhone: uniquePhone(),
      title: "اختبار محتوى التقويم",
    });

    const baselId = await demoUserId(db, "basel");
    await db.query(
      `insert into appointments (job_id, type, scheduled_start, status, location)
       values ($1, 'installation', now(), 'scheduled', $2)`,
      [job.jobId, uniqueLocation],
    );
    const { rows: apptRows } = await db.query(
      `select id from appointments where job_id = $1`,
      [job.jobId],
    );
    await db.query(
      `insert into appointment_assignees (appointment_id, user_id) values ($1, $2)`,
      [apptRows[0].id, baselId],
    );

    await page.goto("/calendar", { waitUntil: "networkidle" });
    // "اليوم كله" (all-day row label) only ever comes from the registered
    // @fullcalendar/core/locales/ar module — it is NOT one of the 5 labels
    // calendar-view.tsx overrides manually via buttonText, so its presence
    // proves the locale module is actually wired in, not just locale="ar"
    // as an inert prop.
    await page.click('button:has-text("أسبوع")');
    await page.waitForTimeout(500);
    let text = await page.innerText("body");
    expect(text).toContain("اليوم كله");

    expect(text).toContain(job.jobNumber);
    expect(text).toContain(DEMO_USERS.basel.name);
    expect(text).toContain(uniqueLocation);
  });
});
