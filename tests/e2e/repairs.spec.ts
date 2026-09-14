import {
  test,
  expect,
  createLeadJob,
  drawSignature,
  uniquePhone,
  uniqueLabel,
} from "./fixtures";

/**
 * Spec section 87: repair status transitions (explicit only) and
 * closeJobAction's repair/balance gating.
 *
 * Ground truth checked directly in src/server/repairs/actions.ts before
 * writing the "resolving advances the job back to installed" assertions:
 * resolving a repair force-sets the job straight to the 'installed'
 * status key (a deliberate, explicitly-commented exception to
 * advanceJobStatus's forward-only guard — 'installed' sorts BEFORE
 * repair_needed/repair_scheduled), gated only on (a) the job's current
 * status still being repair_needed/repair_scheduled and (b) no other
 * open/scheduled/in_progress repair remaining on the job. It does NOT
 * check whether the job ever passed through an actual installation
 * appointment first — so these tests exercise that real, narrower
 * condition directly (from a freshly converted job, well before any
 * factory/installation steps) rather than driving the whole upstream
 * pipeline just to reach the same job_statuses row.
 */

/**
 * Signs a quote via its real public link — the customer's own signature now
 * runs the auto-convert-to-job + auto-send-to-factory cascade right after
 * the signature transaction commits (see src/server/quotes/actions.ts's
 * runPostSignAutomation), so there is no manual "تحويل العرض إلى مهمة"
 * click here any more: by the time this returns, the job is already
 * converted (its items/price already set from the quote). Neither repair
 * test below cares about the factory step itself, only that the job is a
 * real, priced, non-terminal job to report a repair against.
 */
async function quoteAndSignQuote(page: import("@playwright/test").Page, price: string) {
  await page.click('button:has-text("إنشاء عرض سعر")');
  const dialog = page.locator('[role="dialog"]');
  await dialog.locator('input[placeholder="الوصف"]').fill("بند اختبار إصلاح");
  await dialog.locator('input[placeholder="الكمية"]').fill("1");
  await dialog.locator('input[placeholder="السعر"]').fill(price);
  await dialog.locator('button:has-text("حفظ عرض السعر")').click();
  await page.waitForTimeout(700);

  await page.click('button:has-text("إرسال للعميل")');
  await page.waitForSelector("text=رابط توقيع العرض جاهز", { timeout: 10_000 });
  const link = await page.locator("input[readonly]").inputValue();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  const customerCtx = await page.context().browser()!.newContext({ locale: "ar" });
  const customerPage = await customerCtx.newPage();
  await customerPage.goto(link, { waitUntil: "networkidle" });
  // Master prompt section 8: national ID is now mandatory before signing —
  // see the matching comment in financial.spec.ts's identical helper.
  await customerPage.fill("#customerNationalIdAtSigning", "302345678");
  await customerPage.fill("#customerAddressAtSigning", "شارع الاختبار 1، حيفا");
  await drawSignature(customerPage);
  await customerPage.check("#agreedToTerms");
  await customerPage.locator('button:has-text("توقيع والموافقة على العرض")').click();
  await customerPage.waitForSelector("text=تم توقيع عرض السعر", { timeout: 10_000 });
  await customerCtx.close();

  await page.reload({ waitUntil: "networkidle" });
  await expect(page.locator('button:has-text("تحويل العرض إلى مهمة")')).toHaveCount(0);
}

test.describe("repair status transitions", () => {
  test("moves explicitly open -> scheduled -> in_progress -> resolved, never automatically, and resolving advances the job back to 'installed'", async ({
    page,
    loginAs,
    db,
  }) => {
    await loginAs(page, "mohammad");
    const job = await createLeadJob(page, {
      customerName: uniqueLabel("عميل تتبع إصلاح"),
      customerPhone: uniquePhone(),
      title: "اختبار حالات الإصلاح",
    });
    await quoteAndSignQuote(page, "300");

    await page.click('button:has-text("الإبلاغ عن مشكلة")');
    const problemLabel = uniqueLabel("خدش على الزجاج");
    const createDialog = page.locator('[role="dialog"]');
    await createDialog.locator("#problemDescription").fill(problemLabel);
    await createDialog.locator('button:has-text("تسجيل")').click();
    await page.waitForSelector("text=تم تسجيل الإصلاح", { timeout: 10_000 });
    await page.waitForTimeout(400);

    let text = await page.innerText("body");
    expect(text).toContain("يحتاج إصلاح"); // repair_needed
    const { rows: created } = await db.query(
      `select status from repairs where job_id = $1 and problem_description = $2`,
      [job.jobId, problemLabel],
    );
    expect(created[0].status).toBe("open");

    const repairsCard = page.locator('[data-slot="card"]', { hasText: "الإصلاحات" });
    const repairRow = repairsCard.locator("li", { hasText: problemLabel });

    async function moveTo(label: string) {
      await repairRow.locator('[role="combobox"]').click();
      await page.locator(`[role="option"]:has-text("${label}")`).click();
      await page.waitForSelector("text=تم تحديث حالة الإصلاح", { timeout: 10_000 });
      await page.waitForTimeout(400);
    }

    await moveTo("مجدول");
    let repairRows = await db.query(
      `select status, resolved_at from repairs where job_id = $1 and problem_description = $2`,
      [job.jobId, problemLabel],
    );
    expect(repairRows.rows[0].status).toBe("scheduled");
    expect(repairRows.rows[0].resolved_at).toBeNull();
    let jobRows = await db.query(
      `select js.key from jobs j join job_statuses js on js.id = j.status_id where j.id = $1`,
      [job.jobId],
    );
    expect(jobRows.rows[0].key).toBe("repair_needed"); // a mere repair-status move never touches the job's own status

    await moveTo("قيد التنفيذ");
    repairRows = await db.query(`select status from repairs where job_id = $1 and problem_description = $2`, [
      job.jobId,
      problemLabel,
    ]);
    expect(repairRows.rows[0].status).toBe("in_progress");

    await moveTo("تم الحل");
    repairRows = await db.query(
      `select status, resolved_at from repairs where job_id = $1 and problem_description = $2`,
      [job.jobId, problemLabel],
    );
    expect(repairRows.rows[0].status).toBe("resolved");
    expect(repairRows.rows[0].resolved_at).not.toBeNull();

    jobRows = await db.query(
      `select js.key from jobs j join job_statuses js on js.id = j.status_id where j.id = $1`,
      [job.jobId],
    );
    expect(jobRows.rows[0].key).toBe("installed");
    text = await page.innerText("body");
    expect(text).toContain("تم التركيب");
  });
});

test.describe("closeJobAction gating", () => {
  test("blocks on an open repair, then on outstanding balance, then succeeds, then rejects a stale double-close", async ({
    page,
    loginAs,
    db,
    browser,
  }) => {
    await loginAs(page, "mohammad");
    const job = await createLeadJob(page, {
      customerName: uniqueLabel("عميل إغلاق مهمة"),
      customerPhone: uniquePhone(),
      title: "اختبار إغلاق المهمة",
    });
    await quoteAndSignQuote(page, "400");

    await page.click('button:has-text("الإبلاغ عن مشكلة")');
    const dialog = page.locator('[role="dialog"]');
    await dialog.locator("#problemDescription").fill("مشكلة اختبار إغلاق المهمة");
    await dialog.locator('button:has-text("تسجيل")').click();
    await page.waitForSelector("text=تم تسجيل الإصلاح", { timeout: 10_000 });
    await page.waitForTimeout(400);

    // Blocked: an open repair.
    await page.click('button:has-text("إغلاق المهمة")');
    await page.locator('[role="alertdialog"]').locator('button:has-text("تأكيد الإغلاق")').click();
    await page.waitForSelector("text=لا يمكن إغلاق المهمة قبل حل جميع طلبات الإصلاح المفتوحة عليها", {
      timeout: 10_000,
    });
    let jobRows = await db.query(
      `select js.key, js.is_terminal from jobs j join job_statuses js on js.id = j.status_id where j.id = $1`,
      [job.jobId],
    );
    expect(jobRows.rows[0].is_terminal).toBe(false);

    const repairsCard = page.locator('[data-slot="card"]', { hasText: "الإصلاحات" });
    await repairsCard.locator('[role="combobox"]').click();
    await page.locator('[role="option"]:has-text("تم الحل")').click();
    await page.waitForSelector("text=تم تحديث حالة الإصلاح", { timeout: 10_000 });
    await page.waitForTimeout(400);

    // Blocked: outstanding balance (400.00 sale price, nothing paid yet).
    await page.click('button:has-text("إغلاق المهمة")');
    await page.locator('[role="alertdialog"]').locator('button:has-text("تأكيد الإغلاق")').click();
    await page.waitForSelector("text=لا يمكن إغلاق المهمة قبل تحصيل كامل المبلغ المستحق", {
      timeout: 10_000,
    });
    jobRows = await db.query(
      `select js.is_terminal from jobs j join job_statuses js on js.id = j.status_id where j.id = $1`,
      [job.jobId],
    );
    expect(jobRows.rows[0].is_terminal).toBe(false);

    // Collect full payment as the super admin (Amr) rather than Mohammad:
    // a regular APPROVE_PAYMENT holder recording their own payment now
    // lands pending (requester != approver, master prompt section 9) —
    // only a super admin's explicit override still auto-approves in the
    // same action, which is what this step needs to move straight on to
    // testing the close gate itself.
    await loginAs(page, "amr");
    await page.goto(job.href, { waitUntil: "networkidle" });
    await page.click('button:has-text("إضافة دفعة")');
    const payDialog = page.locator('[role="dialog"]');
    await payDialog.locator("#amount").fill("400");
    await payDialog.locator('button:has-text("إضافة الدفعة")').click();
    await page.waitForSelector("text=تم تسجيل الدفعة", { timeout: 10_000 });
    await page.waitForTimeout(400);

    // Back to Mohammad for the actual close-gate assertions below.
    await loginAs(page, "mohammad");
    await page.goto(job.href, { waitUntil: "networkidle" });

    // A second, stale session has this job open too, before the close.
    const staleCtx = await browser.newContext({ locale: "ar" });
    const stalePage = await staleCtx.newPage();
    await loginAs(stalePage, "mohammad");
    await stalePage.goto(job.href, { waitUntil: "networkidle" });

    await page.click('button:has-text("إغلاق المهمة")');
    await page.locator('[role="alertdialog"]').locator('button:has-text("تأكيد الإغلاق")').click();
    await page.waitForSelector("text=تم إغلاق المهمة", { timeout: 10_000 });
    jobRows = await db.query(
      `select js.key from jobs j join job_statuses js on js.id = j.status_id where j.id = $1`,
      [job.jobId],
    );
    expect(jobRows.rows[0].key).toBe("completed");
    const { rows: auditRows1 } = await db.query(
      `select count(*)::int as c from audit_logs where action = 'job.close' and entity_id = $1`,
      [job.jobId],
    );
    expect(auditRows1[0].c).toBe(1);

    // The stale tab's Close button is still in its (unrefreshed) DOM.
    await stalePage.click('button:has-text("إغلاق المهمة")');
    await stalePage.locator('[role="alertdialog"]').locator('button:has-text("تأكيد الإغلاق")').click();
    await stalePage.waitForSelector("text=هذه المهمة مغلقة بالفعل", { timeout: 10_000 });
    const { rows: auditRows2 } = await db.query(
      `select count(*)::int as c from audit_logs where action = 'job.close' and entity_id = $1`,
      [job.jobId],
    );
    expect(auditRows2[0].c).toBe(1); // not double-processed
    await staleCtx.close();
  });
});
