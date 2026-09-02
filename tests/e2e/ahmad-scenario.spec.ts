import {
  test,
  expect,
  DEMO_USERS,
  createLeadJob,
  drawSignature,
  moneyPattern,
  uniquePhone,
  uniqueLabel,
  demoUserId,
  jobStatusKey,
  cashAccountId,
  cashBalance,
  jobRemainingBalance,
} from "./fixtures";

/**
 * Spec section 72 — the full worked "Ahmad" scenario, driven LIVE end to
 * end from a brand-new lead through the real UI/server actions, never
 * reading the pre-seeded JOB-2026-0001 (which reflects a static snapshot
 * of the same numeric example). This is a genuine behavioral test of the
 * system, not a re-read of already-seeded rows.
 *
 * Converting a signed quote into a job (src/server/quotes/actions.ts
 * convertQuoteToJob) sets jobs.dealClosedByUserId to the CLOSE_DEAL holder
 * who performed the conversion — a hard prerequisite for
 * src/server/compensation/commission.ts's computeCommission(), which
 * otherwise returns "لا يمكن احتساب العمولة — لم يتم تحديد من أغلق
 * الصفقة لهذه المهمة." This scenario exercises that live code path
 * directly (no manual DB patch), so the commission step below runs the
 * REAL commission formula against REAL job_costs rows end to end.
 *
 * Everything else — measurement -> pricing handoff, quote sign, deposit,
 * factory approval, installation completion, cash handover, compensation,
 * commission estimate, a repair, and closing — runs live through the UI
 * against a fresh customer/job this test creates, so re-running the suite
 * never touches or corrupts JOB-2026-0001 or any other seeded fixture.
 *
 * Two narrative simplifications, both noted where they happen: the
 * "preliminary estimate" step has no dedicated field anywhere in the app
 * (recorded in the job's free-text notes instead), and the installation
 * appointment is scheduled for TODAY rather than literally "next Tuesday"
 * — My Day (where installation completion is reached from) only ever
 * shows today's appointments, and the specific weekday isn't itself
 * behavior under test.
 */

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
function datetimeLocalValue(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function todayAt(hour: number, minute = 0): Date {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d;
}

test.describe("Ahmad end-to-end scenario (spec section 72)", () => {
  test("preliminary lead through installation, compensation, commission, a repair, and closing — with the exact worked numbers", async ({
    page,
    loginAs,
    db,
    browser,
  }) => {
    test.setTimeout(240_000);

    const mohammadId = await demoUserId(db, "mohammad");
    const issamId = await demoUserId(db, "issam");
    const baselId = await demoUserId(db, "basel");

    // -----------------------------------------------------------------
    // 1. Ahmad calls -> preliminary estimate -> measurement scheduled
    // -----------------------------------------------------------------
    await loginAs(page, "mohammad");
    const customerName = uniqueLabel("أحمد — سيناريو كامل");
    const customerPhone = uniquePhone();
    const job = await createLeadJob(page, {
      customerName,
      customerPhone,
      title: "كابينة دش زجاجية + درابزين درج",
      // No dedicated "preliminary estimate" field anywhere in the app —
      // recorded in free-text notes, as an intake person genuinely would.
      notes: "تقدير مبدئي هاتفي: بين 10,000 و13,000 شيكل، حسب القياس الدقيق.",
    });
    expect((await page.innerText("body"))).toContain("عميل محتمل جديد"); // new_lead

    // Assign Basel to the job first — the job DETAIL page itself requires
    // either VIEW_ALL_JOBS or genuine involvement (src/app/(app)/jobs/
    // [id]/page.tsx's isInvolved: measured-by / pricing-responsible /
    // deal-closer / an explicit job_assignments row), which merely being
    // an appointment ASSIGNEE (below) does not by itself satisfy — Basel
    // (seeded: VIEW_ASSIGNED_JOBS only) needs to open this job's own page
    // to record the measurement in step 2.
    await page.click('button:has-text("تعيين فني")');
    let dialog = page.locator('[role="dialog"]');
    await dialog.locator("#userId").click();
    await page.locator(`[role="option"]:has-text("${DEMO_USERS.basel.name}")`).click();
    await dialog.locator('button:has-text("تعيين"):not(:has-text("فني"))').click();
    await page.waitForTimeout(500);

    await page.click('button:has-text("جدولة موعد")');
    dialog = page.locator('[role="dialog"]');
    await dialog.locator("#scheduledStart").fill(datetimeLocalValue(todayAt(9, 0))); // measurement is the dialog's default type
    await dialog.locator(`#assignee-${baselId}`).click();
    await dialog.locator('button:has-text("جدولة")').click();
    await page.waitForSelector("text=تم جدولة الموعد بنجاح", { timeout: 10_000 });
    await page.waitForTimeout(400);
    expect(await jobStatusKey(db, job.jobId)).toBe("measurement_scheduled");

    // -----------------------------------------------------------------
    // 2. Basel measures (holds CREATE_MEASUREMENT but no pricing
    // permission at all) -> the job moves past the lead/scheduled stages,
    // handed to Mohammad for pricing.
    // -----------------------------------------------------------------
    await loginAs(page, "basel");
    await page.goto(job.href, { waitUntil: "networkidle" });
    await expect(page.locator('button:has-text("إنشاء عرض سعر")')).toHaveCount(0); // no CREATE_QUOTE
    await page.click('button:has-text("إضافة قياس")');
    dialog = page.locator('[role="dialog"]');
    await dialog.locator("#details").fill("2.10م × 0.90م لكابينة الدش، 3.4م لدرابزين الدرج.");
    await dialog.locator("#photosTaken").click();
    await dialog.locator("#pricingResponsibleUserId").click();
    await page.locator(`[role="option"]:has-text("${DEMO_USERS.mohammad.name}")`).click();
    await dialog.locator('button:has-text("حفظ القياس")').click();
    await page.waitForSelector('[role="dialog"]', { state: "detached", timeout: 10_000 });
    await page.waitForTimeout(400);

    const { rows: afterMeasure } = await db.query(
      `select measured_by_user_id, pricing_responsible_user_id from jobs where id = $1`,
      [job.jobId],
    );
    expect(afterMeasure[0].measured_by_user_id).toBe(baselId);
    expect(afterMeasure[0].pricing_responsible_user_id).toBe(mohammadId);
    // Real observed status key: measurement_completed ("تم القياس") — the
    // job_statuses row literally named "waiting_for_pricing" exists in the
    // catalogue but nothing in this codebase's live actions ever sets it
    // (confirmed by reading src/server/jobs/actions.ts and grepping the
    // whole server tree); pricingResponsibleUserId is the real mechanism
    // that hands the job to Mohammad for pricing, which is what matters
    // here, not the exact status-badge wording.
    expect(await jobStatusKey(db, job.jobId)).toBe("measurement_completed");

    // -----------------------------------------------------------------
    // 3. Mohammad quotes 12,000 -> sends a secure link -> customer signs.
    // -----------------------------------------------------------------
    await loginAs(page, "mohammad");
    await page.goto(job.href, { waitUntil: "networkidle" });
    await page.click('button:has-text("إنشاء عرض سعر")');
    dialog = page.locator('[role="dialog"]');
    await dialog.locator('input[placeholder="الوصف"]').fill("توريد وتركيب كابينة دش زجاجية ودرابزين درج");
    await dialog.locator('input[placeholder="الكمية"]').fill("1");
    await dialog.locator('input[placeholder="السعر"]').fill("12000");
    await dialog.locator("#paymentTerms").fill("دفعة أولى 3,000 عند التوقيع، والباقي عند التركيب.");
    await dialog.locator('button:has-text("حفظ عرض السعر")').click();
    await page.waitForTimeout(700);
    let text = await page.innerText("body");
    expect(moneyPattern("12000.00").test(text)).toBe(true);

    await page.click('button:has-text("إرسال للعميل")');
    await page.waitForSelector("text=رابط توقيع العرض جاهز", { timeout: 10_000 });
    const signingLink = await page.locator("input[readonly]").inputValue();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    const customerCtx = await browser.newContext({ locale: "ar" });
    const customerPage = await customerCtx.newPage();
    await customerPage.goto(signingLink, { waitUntil: "networkidle" });
    text = await customerPage.innerText("body");
    expect(moneyPattern("12000.00").test(text)).toBe(true);
    await drawSignature(customerPage);
    await customerPage.check("#agreedToTerms");
    await customerPage.locator('button:has-text("توقيع والموافقة على العرض")').click();
    await customerPage.waitForSelector("text=تم توقيع عرض السعر", { timeout: 10_000 });
    await customerCtx.close();

    await page.goto(job.href, { waitUntil: "networkidle" });
    await page.click('button:has-text("تحويل العرض إلى مهمة")');
    await page.locator('[role="alertdialog"] button:has-text("تحويل"):not(:has-text("العرض"))').click();
    await page.waitForTimeout(800);
    text = await page.innerText("body");
    expect(text).toContain("بانتظار الإنتاج"); // waiting_for_production
    expect(moneyPattern("12000.00").test(text)).toBe(true);

    const { rows: afterConvert } = await db.query(
      `select deal_closed_by_user_id from jobs where id = $1`,
      [job.jobId],
    );
    expect(afterConvert[0].deal_closed_by_user_id).toBe(mohammadId);

    // -----------------------------------------------------------------
    // 4. Mohammad records a 3,000 cash deposit — he holds APPROVE_PAYMENT
    // himself, so it's auto-approved and credits his own cash box
    // immediately (recordCustomerPayment's documented design).
    // -----------------------------------------------------------------
    const mohammadCash = await cashAccountId(db, "user", mohammadId);
    const mohammadCashBeforeDeposit = await cashBalance(db, mohammadCash);

    await page.click('button:has-text("إضافة دفعة")');
    dialog = page.locator('[role="dialog"]');
    await dialog.locator("#amount").fill("3000");
    await dialog.locator('button:has-text("إضافة الدفعة")').click();
    await page.waitForSelector("text=تم تسجيل الدفعة", { timeout: 10_000 });
    await page.waitForTimeout(400);
    text = await page.innerText("body");
    expect(text).not.toContain("بانتظار الاعتماد");
    expect(moneyPattern("3000.00").test(text)).toBe(true); // collected
    expect(moneyPattern("9000.00").test(text)).toBe(true); // remaining = 12,000 - 3,000
    expect((await cashBalance(db, mohammadCash)) - mohammadCashBeforeDeposit).toBe(3000);

    // -----------------------------------------------------------------
    // 5. Production request -> factory submits 3,200 -> Mohammad approves
    // -> job cost becomes an approved 3,200.00 factory_glass row.
    // -----------------------------------------------------------------
    await page.click('button:has-text("إرسال إلى المصنع")');
    dialog = page.locator('[role="dialog"]');
    await dialog.locator('button:has-text("إرسال إلى المصنع")').click();
    await page.waitForSelector("text=تم إنشاء طلب الإنتاج", { timeout: 10_000 });
    const factoryLink = await dialog.locator("input[readonly]").inputValue();
    await dialog.locator('button:has-text("تم")').click();
    await page.waitForTimeout(300);
    expect(await jobStatusKey(db, job.jobId)).toBe("in_production");

    const factoryCtx = await browser.newContext({ locale: "ar" });
    const factoryPage = await factoryCtx.newPage();
    await factoryPage.goto(factoryLink, { waitUntil: "networkidle" });
    await factoryPage.fill("#submittedPrice", "3200");
    await factoryPage.locator('button:has-text("إرسال السعر")').click();
    await factoryPage.waitForSelector("text=تم استلام عرضكم", { timeout: 10_000 });
    await factoryCtx.close();

    await page.goto(job.href, { waitUntil: "networkidle" });
    await page.click('button:has-text("اعتماد السعر")');
    await page
      .locator('[role="alertdialog"]')
      .locator('button:has-text("اعتماد"):not(:has-text("السعر"))')
      .click();
    await page.waitForTimeout(700);
    expect(await jobStatusKey(db, job.jobId)).toBe("ready_from_factory");

    const { rows: factoryCostRows } = await db.query(
      `select amount, category, status from job_costs where job_id = $1 and category = 'factory_glass'`,
      [job.jobId],
    );
    expect(factoryCostRows).toHaveLength(1);
    expect(factoryCostRows[0].amount).toBe("3200.00");
    expect(factoryCostRows[0].status).toBe("approved");

    // -----------------------------------------------------------------
    // 6. Installation scheduled today (My Day only ever shows today's
    // appointments — see file header comment), Issam + Basel. Issam is
    // also assigned as an installer directly (ASSIGN_INSTALLER) — the same
    // explicit involvement the seeded Ahmad job itself carries, and Basel
    // already got this in step 1 — so both can genuinely open the job page
    // below, not just appear in My Day.
    // -----------------------------------------------------------------
    await page.click('button:has-text("تعيين فني")');
    const assignDialog = page.locator('[role="dialog"]');
    await assignDialog.locator("#userId").click();
    await page.locator(`[role="option"]:has-text("${DEMO_USERS.issam.name}")`).click();
    await assignDialog.locator('button:has-text("تعيين"):not(:has-text("فني"))').click();
    await page.waitForTimeout(500);

    await page.click('button:has-text("جدولة موعد")');
    dialog = page.locator('[role="dialog"]');
    await dialog.locator("#type").click();
    await page.locator('[role="option"]:has-text("تركيب")').click();
    await dialog.locator("#scheduledStart").fill(datetimeLocalValue(todayAt(9, 0)));
    await dialog.locator(`#assignee-${issamId}`).click();
    await dialog.locator(`#assignee-${baselId}`).click();
    await dialog.locator('button:has-text("جدولة")').click();
    await page.waitForSelector("text=تم جدولة الموعد بنجاح", { timeout: 10_000 });
    await page.waitForTimeout(400);
    expect(await jobStatusKey(db, job.jobId)).toBe("installation_scheduled");

    // -----------------------------------------------------------------
    // 7. Issam completes the installation (shower cabin + railing — the
    // dialog defaults every pending item to installed), documents a
    // photo, and collects 5,000 cash. Issam lacks APPROVE_PAYMENT, so it
    // lands pending, not yet credited to his cash box.
    // -----------------------------------------------------------------
    const issamCashBeforeCollection = await cashBalance(db, await cashAccountId(db, "user", issamId));

    await loginAs(page, "issam");
    await page.goto("/my-day", { waitUntil: "networkidle" });
    const jobCard = page.locator('[data-slot="card"]', { hasText: job.jobNumber });
    await jobCard.locator('button:has-text("إكمال التركيب")').click();
    dialog = page.locator('[role="dialog"]');
    await dialog.locator("#photoTaken").click();
    await dialog.locator("#paymentCollected").click();
    await dialog.locator("#paymentAmount").fill("5000");
    await dialog.locator('button:has-text("إكمال التركيب")').last().click();
    await page.waitForSelector("text=تم إكمال التركيب", { timeout: 10_000 });
    await page.waitForTimeout(500);

    expect(await jobStatusKey(db, job.jobId)).toBe("installed");
    const { rows: jobItemRows } = await db.query(
      `select status from job_items where job_id = $1`,
      [job.jobId],
    );
    expect(jobItemRows.length).toBeGreaterThan(0);
    expect(jobItemRows.every((r) => r.status === "installed")).toBe(true);

    const { rows: pendingPaymentRows } = await db.query(
      `select amount, approval_status, received_by_user_id from customer_payments
       where job_id = $1 order by created_at desc limit 1`,
      [job.jobId],
    );
    expect(pendingPaymentRows[0].amount).toBe("5000.00");
    expect(pendingPaymentRows[0].approval_status).toBe("pending");
    expect(pendingPaymentRows[0].received_by_user_id).toBe(issamId);
    expect(await cashBalance(db, await cashAccountId(db, "user", issamId))).toBe(
      issamCashBeforeCollection,
    ); // pending money is not real money yet

    // -----------------------------------------------------------------
    // 8. Mohammad approves the 5,000 -> Issam's cash box credited ->
    // customer paid total 8,000, remaining 4,000.
    // -----------------------------------------------------------------
    await loginAs(page, "mohammad");
    await page.goto(job.href, { waitUntil: "networkidle" });
    await page.click('button:has-text("اعتماد")');
    await page.locator('[role="alertdialog"]').locator('button:has-text("اعتماد")').click();
    await page.waitForSelector("text=تم اعتماد الدفعة", { timeout: 10_000 });
    await page.waitForTimeout(400);
    text = await page.innerText("body");
    expect(moneyPattern("8000.00").test(text)).toBe(true); // paid = 3,000 + 5,000
    expect(moneyPattern("4000.00").test(text)).toBe(true); // remaining = 12,000 - 8,000
    expect(
      (await cashBalance(db, await cashAccountId(db, "user", issamId))) - issamCashBeforeCollection,
    ).toBe(5000);

    // -----------------------------------------------------------------
    // 9. Issam hands the 5,000 to the company; Mohammad confirms receipt.
    // Net effect on Issam's own cash box across collecting + handing over
    // is exactly zero; the company's account gains exactly 5,000.
    // -----------------------------------------------------------------
    const companyCash = await cashAccountId(db, "company");
    const companyCashBefore = await cashBalance(db, companyCash);

    await loginAs(page, "issam");
    await page.goto("/finance", { waitUntil: "networkidle" });
    await page.click('button:has-text("تسليم نقدية")');
    dialog = page.locator('[role="dialog"]');
    await dialog.locator("#transfer-amount").fill("5000");
    await dialog.locator("#transfer-notes").fill("تسليم مقبوضات تركيب أحمد — سيناريو كامل");
    await dialog.locator('button:has-text("تسليم")').click();
    await page.waitForSelector("text=تم تسجيل عملية التسليم", { timeout: 10_000 });
    await page.waitForTimeout(400);

    await loginAs(page, "mohammad");
    await page.goto("/finance", { waitUntil: "networkidle" });
    const transferRow = page.locator("li", { hasText: "5,000.00" }).filter({ hasText: "من عصام" });
    await transferRow.locator('button:has-text("تأكيد الاستلام")').click();
    await page.locator('[role="alertdialog"]').locator('button:has-text("تأكيد")').click();
    await page.waitForSelector("text=تم تأكيد الاستلام", { timeout: 10_000 });
    await page.waitForTimeout(400);

    expect(await cashBalance(db, await cashAccountId(db, "user", issamId))).toBe(
      issamCashBeforeCollection,
    ); // collected 5,000 then handed over 5,000 — net zero
    expect((await cashBalance(db, companyCash)) - companyCashBefore).toBe(5000);

    // -----------------------------------------------------------------
    // 10. Compensation allocated — Issam 1,250, Basel 450. NOT an equal
    // split, each its own explicit amount.
    // -----------------------------------------------------------------
    await page.goto(job.href, { waitUntil: "networkidle" });

    async function allocateEarning(name: string, amount: string) {
      await page.click('button:has-text("تخصيص تعويض تركيب")');
      const d = page.locator('[role="dialog"]');
      await d.locator("#userId").click();
      await page.locator(`[role="option"]:has-text("${name}")`).click();
      await d.locator('button:has-text("مبلغ مخصص")').click();
      await d.locator("#customDescription").fill(`تركيب أحمد — سيناريو كامل (${name})`);
      await d.locator("#customAmount").fill(amount);
      await d.locator('button:has-text("تخصيص المستحق")').click();
      await page.waitForSelector("text=تم تخصيص المستحق", { timeout: 10_000 });
      await page.waitForTimeout(400);
    }
    await allocateEarning(DEMO_USERS.issam.name, "1250");
    await allocateEarning(DEMO_USERS.basel.name, "450");

    const { rows: laborCosts } = await db.query(
      `select vendor_user_id, amount, status from job_costs where job_id = $1 and category = 'installer_labor'`,
      [job.jobId],
    );
    expect(laborCosts).toHaveLength(2);
    expect(
      laborCosts.some((r) => r.vendor_user_id === issamId && r.amount === "1250.00" && r.status === "approved"),
    ).toBe(true);
    expect(
      laborCosts.some((r) => r.vendor_user_id === baselId && r.amount === "450.00" && r.status === "approved"),
    ).toBe(true);

    // -----------------------------------------------------------------
    // 11. Hardware cost 1,000 (Mohammad holds APPROVE_REQUESTS himself ->
    // auto-approved) -> job costs total 5,900 = 3,200 + 1,000 + 1,700.
    // -----------------------------------------------------------------
    const costsCard = page.locator('[data-slot="card"]', { hasText: "التكاليف" });
    await costsCard.locator('button:has-text("إضافة تكلفة")').click();
    dialog = page.locator('[role="dialog"]');
    await dialog.locator("#amount").fill("1000");
    await dialog.locator("#description").fill("مشابك، مفصلات، سيليكون — كابينة الدش والدرابزين");
    await dialog.locator('button:has-text("إضافة التكلفة")').click();
    await page.waitForSelector("text=تم تسجيل التكلفة", { timeout: 10_000 });
    await page.waitForTimeout(400);

    const { rows: totalRows } = await db.query(
      `select coalesce(sum(amount), 0)::text as total from job_costs where job_id = $1 and status = 'approved'`,
      [job.jobId],
    );
    expect(Number(totalRows[0].total)).toBe(5900);
    await page.reload({ waitUntil: "networkidle" });
    text = await page.innerText("body");
    expect(moneyPattern("5900.00").test(text)).toBe(true);

    // -----------------------------------------------------------------
    // 12. Gross profit 6,100 = 12,000 - 5,900 -> Mohammad's commission
    // estimated at the current commission_rate_percent setting (10% by
    // default -> 610.00), read from the DB rather than hardcoded so this
    // holds even if that global setting has been changed elsewhere.
    // -----------------------------------------------------------------
    const { rows: settingRows } = await db.query(
      `select value from application_settings where key = 'commission_rate_percent'`,
    );
    // application_settings.value is jsonb -> node-postgres already returns
    // it decoded (a plain JS number here), falling back to the coded
    // default (10) only in the never-expected case the seeded row itself
    // is missing.
    const ratePercent = settingRows[0] ? Number(settingRows[0].value) : 10;
    const expectedGrossProfit = 12000 - 5900;
    const expectedCommission = Math.round(expectedGrossProfit * (ratePercent / 100) * 100) / 100;

    await page.click('button:has-text("تقدير العمولة")');
    await page.waitForSelector("text=تم تحديث تقدير العمولة", { timeout: 10_000 });
    await page.waitForTimeout(400);

    const { rows: commissionRows } = await db.query(
      `select estimated_gross_profit, estimated_amount, rate_percent from commissions where job_id = $1`,
      [job.jobId],
    );
    expect(Number(commissionRows[0].estimated_gross_profit)).toBe(expectedGrossProfit);
    expect(Number(commissionRows[0].estimated_amount)).toBeCloseTo(expectedCommission, 2);
    if (ratePercent === 10) {
      expect(commissionRows[0].estimated_gross_profit).toBe("6100.00");
      expect(commissionRows[0].estimated_amount).toBe("610.00");
    }

    // -----------------------------------------------------------------
    // 13. A repair occurs -> appears in Needs Attention -> stays open
    // until explicitly resolved.
    // -----------------------------------------------------------------
    await page.click('button:has-text("الإبلاغ عن مشكلة")');
    dialog = page.locator('[role="dialog"]');
    const repairLabel = uniqueLabel("خدش طفيف على باب الكابينة");
    await dialog.locator("#problemDescription").fill(repairLabel);
    await dialog.locator('button:has-text("تسجيل")').click();
    await page.waitForSelector("text=تم تسجيل الإصلاح", { timeout: 10_000 });
    await page.waitForTimeout(400);
    expect(await jobStatusKey(db, job.jobId)).toBe("repair_needed");

    await page.goto("/dashboard", { waitUntil: "networkidle" });
    const openRepairsRow = page.locator("li", { hasText: "إصلاحات مفتوحة" });
    await expect(openRepairsRow).toBeVisible();
    await page.goto("/repairs?status=open", { waitUntil: "networkidle" });
    text = await page.innerText("body");
    expect(text).toContain(job.jobNumber);

    // Not yet closeable — an open repair blocks it.
    await page.goto(job.href, { waitUntil: "networkidle" });
    await page.click('button:has-text("إغلاق المهمة")');
    await page.locator('[role="alertdialog"]').locator('button:has-text("تأكيد الإغلاق")').click();
    await page.waitForSelector("text=لا يمكن إغلاق المهمة قبل حل جميع طلبات الإصلاح المفتوحة عليها", {
      timeout: 10_000,
    });

    // -----------------------------------------------------------------
    // 14. The remaining 4,000 collected -> repair resolved -> job closed,
    // status Completed, remaining ₪0.00 (fully paid).
    // -----------------------------------------------------------------
    await page.click('button:has-text("إضافة دفعة")');
    dialog = page.locator('[role="dialog"]');
    await dialog.locator("#amount").fill("4000");
    await dialog.locator('button:has-text("إضافة الدفعة")').click();
    await page.waitForSelector("text=تم تسجيل الدفعة", { timeout: 10_000 });
    await page.waitForTimeout(400);
    text = await page.innerText("body");
    expect(moneyPattern("12000.00").test(text)).toBe(true); // fully collected
    expect(await jobRemainingBalance(db, job.jobId)).toBe(0); // recomputed to zero, not stored

    const repairsCard = page.locator('[data-slot="card"]', { hasText: "الإصلاحات" });
    const repairRow = repairsCard.locator("li", { hasText: repairLabel });
    await repairRow.locator('[role="combobox"]').click();
    await page.locator('[role="option"]:has-text("تم الحل")').click();
    await page.waitForSelector("text=تم تحديث حالة الإصلاح", { timeout: 10_000 });
    await page.waitForTimeout(400);
    expect(await jobStatusKey(db, job.jobId)).toBe("installed");

    await page.click('button:has-text("إغلاق المهمة")');
    await page.locator('[role="alertdialog"]').locator('button:has-text("تأكيد الإغلاق")').click();
    await page.waitForSelector("text=تم إغلاق المهمة", { timeout: 10_000 });
    await page.waitForTimeout(400);

    expect(await jobStatusKey(db, job.jobId)).toBe("completed");
    text = await page.innerText("body");
    expect(text).toContain("مكتمل");
    expect(await jobRemainingBalance(db, job.jobId)).toBe(0); // remaining stays 0 — Fully Paid
  });
});
