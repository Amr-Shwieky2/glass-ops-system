import {
  test,
  expect,
  createLeadJob,
  uniquePhone,
  uniqueLabel,
  demoUserId,
} from "./fixtures";

/**
 * Sprint 6 regression coverage: customer detail page completeness with
 * correct financial gating, the automatic payment-status label, the
 * negative-cash-balance guard, and the cleared-incoming-check ->
 * customer_payment conversion (R1.15/R1.18/R1.27/S6 completeness).
 */

test.describe("Sprint 6 — customer page completeness, payment status, cash-drawer integrity", () => {
  test("the customer page shows quotes/payments/balance/payment-status for a financial viewer, and hides every financial section for an involved viewer without VIEW_SALE_PRICE", async ({
    page,
    loginAs,
    db,
  }) => {
    await loginAs(page, "mohammad");
    const job = await createLeadJob(page, {
      customerName: uniqueLabel("عميل صفحة العميل"),
      customerPhone: uniquePhone(),
      title: "اختبار اكتمال صفحة العميل",
    });

    const { rows: customerRows } = await db.query(
      `select customer_id from jobs where id = $1`,
      [job.jobId],
    );
    const customerId: string = customerRows[0].customer_id;

    await page.click('button:has-text("إنشاء عرض سعر")');
    const quoteDialog = page.locator('[role="dialog"]');
    await quoteDialog.locator('input[placeholder="الوصف"]').fill("زجاج اختبار صفحة العميل");
    await quoteDialog.locator('input[placeholder="الكمية"]').fill("1");
    await quoteDialog.locator('input[placeholder="السعر"]').fill("2000");
    await quoteDialog.locator('button:has-text("حفظ عرض السعر")').click();
    await page.waitForTimeout(700);

    // Sale price only exists on the job after a signed quote is converted
    // (a full sign flow is already covered end-to-end elsewhere, e.g.
    // ahmad-scenario.spec.ts) — direct SQL here, matching this suite's own
    // "setup the UI doesn't cleanly support" convention, isolates THIS
    // test to what it actually verifies: the customer page's own
    // rendering and gating once a price and payments exist.
    await db.query(`update jobs set sale_price_total = '2000.00' where id = $1`, [job.jobId]);

    // A super admin's own payment auto-approves (recordCustomerPayment) —
    // the simplest way to get a real, approved payment without a second
    // decide step.
    await loginAs(page, "amr");
    await page.goto(job.href, { waitUntil: "networkidle" });
    await page.click('button:has-text("إضافة دفعة")');
    const paymentDialog = page.locator('[role="dialog"]');
    await paymentDialog.locator("#amount").fill("800");
    await paymentDialog.locator('button:has-text("إضافة الدفعة")').click();
    await page.waitForSelector("text=تم تسجيل الدفعة", { timeout: 10_000 });

    await page.goto(`/customers/${customerId}`, { waitUntil: "networkidle" });
    let text = await page.innerText("main");
    expect(text).toContain("الرصيد المستحق");
    expect(text).toContain("مدفوع جزئياً"); // partially_paid: 800 of 2000
    expect(text).toContain("عروض الأسعار"); // the quotes section itself
    expect(text).toMatch(/Q-\d{4}-\d+/); // the quote's own number
    expect(text).toMatch(/800\.00/); // the payment amount

    // Make Basel genuinely involved (job_assignments, "تعيين فني") — of the
    // 4 demo personas, Basel is specifically the one Sprint 1 did NOT grant
    // VIEW_SALE_PRICE to (Amr/Mohammad/Issam all hold it), and he holds no
    // MANAGE_CHECKS either, so every financial section must be entirely
    // absent for him, not merely visually hidden, even though he can
    // otherwise open this page.
    await loginAs(page, "mohammad");
    await page.goto(job.href, { waitUntil: "networkidle" });
    await page.click('button:has-text("تعيين فني")');
    const assignDialog = page.locator('[role="dialog"]');
    await assignDialog.locator("#userId").click();
    await page.locator('[role="option"]:has-text("باسل")').click();
    await assignDialog.locator('button:has-text("تعيين"):not(:has-text("فني"))').click();
    await page.waitForTimeout(500);

    await loginAs(page, "basel");
    await page.goto(`/customers/${customerId}`, { waitUntil: "networkidle" });
    await expect(page.locator("h1", { hasText: "عميل صفحة العميل" })).toBeVisible();
    text = await page.innerText("main");
    expect(text).not.toContain("الرصيد المستحق");
    expect(text).not.toContain("عروض الأسعار");
    expect(text).not.toContain("المدفوعات");
    expect(text).not.toContain("الشيكات الواردة");
    // Non-financial sections still render for an involved viewer.
    expect(text).toContain("سجل المهام");
    expect(text).toContain("الإصلاحات");
    expect(text).toContain("النشاط الأخير");
  });

  test("a cash debit larger than the account's actual balance is refused, and posts no cash_transactions row at all", async ({
    page,
    loginAs,
    db,
  }) => {
    const baselId = await demoUserId(db, "basel");
    const { rows: beforeTx } = await db.query(
      `select count(*)::int as c from cash_transactions ct
       join cash_accounts ca on ca.id = ct.cash_account_id
       where ca.owner_user_id = $1`,
      [baselId],
    );
    const txCountBefore = beforeTx[0].c;

    const expenseDescription = uniqueLabel("اختبار — مبلغ أكبر من الرصيد المتاح");

    await loginAs(page, "basel");
    await page.goto(`/finance/technicians/${baselId}`, { waitUntil: "networkidle" });
    await page.click('button:has-text("الإبلاغ عن مصروف ميداني")');
    const reportDialog = page.locator('[role="dialog"]');
    // Far larger than any realistic seeded balance — robust to exactly
    // what the seed data's own cash history happens to net out to.
    await reportDialog.locator("#expense-amount").fill("999999.00");
    await reportDialog.locator("#expense-description").fill(expenseDescription);
    await reportDialog.locator('button:has-text("إرسال")').click();
    await page.waitForSelector("text=تم إرسال البلاغ", { timeout: 10_000 });

    await loginAs(page, "mohammad"); // MANAGE_TECHNICIAN_PAYMENTS holder
    await page.goto(`/finance/technicians/${baselId}`, { waitUntil: "networkidle" });
    await page.click(`li:has-text("${expenseDescription}") button:has-text("اعتماد")`);
    await page.locator('[role="alertdialog"]').locator('button:has-text("اعتماد")').click();
    await page.waitForTimeout(700);

    // The error surfaces via a toast (sonner), rendered outside <main> — the
    // whole page body, not the main-scoped check used elsewhere in this
    // file for card content that could otherwise collide with nav text.
    const bodyText = await page.innerText("body");
    expect(bodyText).toContain("لا يمكن اعتماد هذا المصروف");

    const { rows: afterTx } = await db.query(
      `select count(*)::int as c from cash_transactions ct
       join cash_accounts ca on ca.id = ct.cash_account_id
       where ca.owner_user_id = $1`,
      [baselId],
    );
    expect(afterTx[0].c).toBe(txCountBefore); // no new row — refused before any insert

    const { rows: reportRows } = await db.query(
      `select status from cash_expense_reports where amount = '999999.00' and description = $1`,
      [expenseDescription],
    );
    expect(reportRows).toHaveLength(1);
    expect(reportRows[0].status).toBe("pending"); // still pending, not silently approved or lost
  });

  test("marking an incoming check 'cleared' creates an approved customer_payment exactly once, moving the job's remaining balance", async ({
    page,
    loginAs,
    db,
  }) => {
    await loginAs(page, "mohammad");
    const job = await createLeadJob(page, {
      customerName: uniqueLabel("عميل شيك محصّل"),
      customerPhone: uniquePhone(),
      title: "اختبار تحصيل شيك",
    });
    await db.query(`update jobs set sale_price_total = '1500.00' where id = $1`, [job.jobId]);

    const { rows: customerRows } = await db.query(
      `select customer_id from jobs where id = $1`,
      [job.jobId],
    );
    const customerId: string = customerRows[0].customer_id;

    const { rows: checkRows } = await db.query(
      `insert into incoming_checks (customer_id, job_id, amount, due_date, status, received_by_user_id)
       values ($1, $2, '1500.00', current_date, 'future', $3)
       returning id`,
      [customerId, job.jobId, await demoUserId(db, "mohammad")],
    );
    const checkId: string = checkRows[0].id;

    await page.goto("/finance", { waitUntil: "networkidle" });
    await page.click('button[role="tab"]:has-text("الشيكات")');
    const checkRow = page.locator("tr", { hasText: "عميل شيك محصّل" }).first();
    await checkRow.locator('button:has-text("تحديث الحالة")').click();
    await page.locator('[role="option"]:has-text("تم التحصيل")').click();
    await page.waitForSelector("text=تم تحديث حالة الشيك", { timeout: 10_000 });

    const { rows: paymentRows } = await db.query(
      `select amount, method, approval_status, job_id from customer_payments where source_incoming_check_id = $1`,
      [checkId],
    );
    expect(paymentRows).toHaveLength(1);
    expect(paymentRows[0].amount).toBe("1500.00");
    expect(paymentRows[0].method).toBe("check");
    expect(paymentRows[0].approval_status).toBe("approved");
    expect(paymentRows[0].job_id).toBe(job.jobId);

    await page.goto(job.href, { waitUntil: "networkidle" });
    const bodyText = await page.innerText("main");
    expect(bodyText).toContain("مدفوع بالكامل"); // fully_paid: 1500 of 1500
  });
});
