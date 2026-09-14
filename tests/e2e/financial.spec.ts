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
  cashAccountId,
  cashBalance,
  approvedLedgerBalance,
  jobRemainingBalance,
} from "./fixtures";

/**
 * Spec section 87: payment-status calculation, payment approval, technician
 * balance, and cash-box balance / a real handover — every one of these is
 * ARCHITECTURE.md section 5's "computed from transaction rows, never a
 * mutable running total" rule, exercised end to end rather than asserted
 * from the doc's prose.
 */

/**
 * Signs a quote via its real public link — the customer's own signature now
 * runs the auto-convert-to-job + auto-send-to-factory cascade right after
 * the signature transaction commits (see src/server/quotes/actions.ts's
 * runPostSignAutomation), so there is no manual "تحويل العرض إلى مهمة"
 * click here any more: by the time this returns, the job is already
 * converted (its items/price already set from the quote). This test only
 * needs a real, priced job to record payments against, not the factory step.
 */
async function quoteAndSignQuote(
  page: import("@playwright/test").Page,
  price: string,
) {
  await page.click('button:has-text("إنشاء عرض سعر")');
  const dialog = page.locator('[role="dialog"]');
  await dialog.locator('input[placeholder="الوصف"]').fill("بند اختبار مالي");
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
  await drawSignature(customerPage);
  await customerPage.check("#agreedToTerms");
  await customerPage.locator('button:has-text("توقيع والموافقة على العرض")').click();
  await customerPage.waitForSelector("text=تم توقيع عرض السعر", { timeout: 10_000 });
  await customerCtx.close();

  await page.reload({ waitUntil: "networkidle" });
  await expect(page.locator('button:has-text("تحويل العرض إلى مهمة")')).toHaveCount(0);
}

test.describe("payment status + approval", () => {
  test("remaining balance recomputes from approved transactions only, and a payment's creator can never decide their own payment even when they hold APPROVE_PAYMENT", async ({
    page,
    loginAs,
    db,
  }) => {
    await loginAs(page, "mohammad");
    const job = await createLeadJob(page, {
      customerName: uniqueLabel("عميل حالة الدفع"),
      customerPhone: uniquePhone(),
      title: "اختبار حالة الدفع",
    });
    await quoteAndSignQuote(page, "1000");
    let text = await page.innerText("body");
    expect(moneyPattern("1000.00").test(text)).toBe(true); // sale total

    // Assign Issam to the job first — the job DETAIL page itself (unlike
    // the payment action's own permission check) requires either
    // VIEW_ALL_JOBS or genuine involvement (src/app/(app)/jobs/[id]/
    // page.tsx's isInvolved), and Issam (seeded: VIEW_ASSIGNED_JOBS only)
    // starts out uninvolved in a job Mohammad alone created and quoted.
    await page.click('button:has-text("تعيين فني")');
    const assignDialog = page.locator('[role="dialog"]');
    await assignDialog.locator("#userId").click();
    await page.locator(`[role="option"]:has-text("${DEMO_USERS.issam.name}")`).click();
    await assignDialog.locator('button:has-text("تعيين"):not(:has-text("فني"))').click();
    await page.waitForTimeout(500);

    // Issam (seeded: COLLECT_PAYMENT, NOT APPROVE_PAYMENT) records 400 ->
    // must land pending, and the job's "remaining" must NOT move yet —
    // pending money is not real money.
    await loginAs(page, "issam");
    await page.goto(job.href, { waitUntil: "networkidle" });
    await page.click('button:has-text("إضافة دفعة")');
    let dialog = page.locator('[role="dialog"]');
    await dialog.locator("#amount").fill("400");
    await dialog.locator('button:has-text("إضافة الدفعة")').click();
    await page.waitForSelector("text=تم تسجيل الدفعة", { timeout: 10_000 });
    await page.waitForTimeout(400);
    text = await page.innerText("body");
    expect(text).toContain("بانتظار الاعتماد");
    expect(moneyPattern("1000.00").test(text)).toBe(true); // remaining still full

    // Mohammad (APPROVE_PAYMENT) approves it -> remaining now recomputes.
    await loginAs(page, "mohammad");
    await page.goto(job.href, { waitUntil: "networkidle" });
    await page.click('button:has-text("اعتماد")');
    await page.locator('[role="alertdialog"]').locator('button:has-text("اعتماد")').click();
    await page.waitForSelector("text=تم اعتماد الدفعة", { timeout: 10_000 });
    await page.waitForTimeout(400);
    text = await page.innerText("body");
    expect(moneyPattern("400.00").test(text)).toBe(true); // collected
    expect(moneyPattern("600.00").test(text)).toBe(true); // remaining = 1000 - 400

    // Mohammad (who himself holds APPROVE_PAYMENT) records the remaining
    // 600 -> lands PENDING, same as anyone else's payment: recording and
    // approving are the same actor here, and a requester may not approve
    // their own request (master prompt section 9) merely by virtue of
    // holding the approve permission. Only a super admin's explicit
    // override auto-approves (see recordCustomerPayment's
    // actingUserIsSuperAdmin param) — Mohammad is a regular manager, not
    // the seeded super admin.
    await page.click('button:has-text("إضافة دفعة")');
    dialog = page.locator('[role="dialog"]');
    await dialog.locator("#amount").fill("600");
    await dialog.locator('button:has-text("إضافة الدفعة")').click();
    await page.waitForSelector("text=تم تسجيل الدفعة", { timeout: 10_000 });
    await page.waitForTimeout(400);
    text = await page.innerText("body");
    expect(text).toContain("بانتظار الاعتماد"); // still pending — Mohammad requested it
    expect(moneyPattern("600.00").test(text)).toBe(true); // remaining still 400 collected / 600 owed

    // Mohammad himself cannot approve his own pending payment — the
    // approve button must not even be offered for a payment he created.
    const ownPendingRow = page.locator("li", { hasText: "600.00" }).filter({ hasText: "بانتظار الاعتماد" });
    await expect(ownPendingRow.locator('button:has-text("اعتماد")')).toHaveCount(0);

    // A different APPROVE_PAYMENT holder (the super admin) decides it.
    await loginAs(page, "amr");
    await page.goto(job.href, { waitUntil: "networkidle" });
    await page.click('button:has-text("اعتماد")');
    await page.locator('[role="alertdialog"]').locator('button:has-text("اعتماد")').click();
    await page.waitForSelector("text=تم اعتماد الدفعة", { timeout: 10_000 });
    await page.waitForTimeout(400);
    text = await page.innerText("body");
    expect(text.match(/بانتظار الاعتماد/g)?.length ?? 0).toBe(0); // no pending badge anywhere now
    expect(moneyPattern("1000.00").test(text)).toBe(true); // fully collected
    expect(await jobRemainingBalance(db, job.jobId)).toBe(0); // 1000 - 1000, computed not stored
  });
});

test.describe("technician balance", () => {
  test("a technician's balance only ever reflects APPROVED ledger entries, and moves by exactly the approved amount", async ({
    page,
    loginAs,
    db,
  }) => {
    const baselId = await demoUserId(db, "basel");
    const before = await approvedLedgerBalance(db, baselId);

    await loginAs(page, "basel");
    await page.goto(`/finance/technicians/${baselId}`, { waitUntil: "networkidle" });
    await page.click('button:has-text("الإبلاغ عن دفعة مستلمة")');
    const dialog = page.locator('[role="dialog"]');
    await dialog.locator("#report-amount").fill("77");
    await dialog.locator("#report-note").fill("اختبار مالي — بلاغ باسل");
    await dialog.locator('button:has-text("إرسال")').click();
    await page.waitForSelector("text=تم إرسال البلاغ", { timeout: 10_000 });
    await page.waitForTimeout(400);

    expect(await approvedLedgerBalance(db, baselId)).toBe(before); // pending, no effect yet

    await loginAs(page, "mohammad"); // MANAGE_TECHNICIAN_PAYMENTS holder
    await page.goto(`/finance/technicians/${baselId}`, { waitUntil: "networkidle" });
    const reportRow = page.locator("li", { hasText: "77.00" }).filter({ hasText: "بانتظار الاعتماد" });
    await reportRow.locator('button:has-text("اعتماد")').click();
    await page.locator('[role="alertdialog"]').locator('button:has-text("اعتماد")').click();
    await page.waitForSelector("text=تم اعتماد القيد", { timeout: 10_000 });
    await page.waitForTimeout(400);

    // A self-reported "payment received" is booked negative (money the
    // technician owes back), so approving it moves the balance DOWN by
    // exactly 77 — never a re-derived/guessed figure.
    expect(await approvedLedgerBalance(db, baselId)).toBe(before - 77);
  });
});

test.describe("cash boxes and handover", () => {
  test("a cash transfer moves nothing until confirmed, then moves BOTH accounts by exactly the transferred amount", async ({
    page,
    loginAs,
    db,
  }) => {
    const issamId = await demoUserId(db, "issam");
    const issamCash = await cashAccountId(db, "user", issamId);
    const companyCash = await cashAccountId(db, "company");
    const issamBefore = await cashBalance(db, issamCash);
    const companyBefore = await cashBalance(db, companyCash);

    await loginAs(page, "issam");
    await page.goto("/finance", { waitUntil: "networkidle" });
    await page.click('button:has-text("تسليم نقدية")');
    const dialog = page.locator('[role="dialog"]');
    await dialog.locator("#transfer-amount").fill("222");
    await dialog.locator("#transfer-notes").fill("اختبار مالي — تسليم عصام");
    await dialog.locator('button:has-text("تسليم")').click();
    await page.waitForSelector("text=تم تسجيل عملية التسليم", { timeout: 10_000 });
    await page.waitForTimeout(400);

    // Unconfirmed: no money has actually moved yet.
    expect(await cashBalance(db, issamCash)).toBe(issamBefore);
    expect(await cashBalance(db, companyCash)).toBe(companyBefore);

    await loginAs(page, "mohammad"); // MANAGE_TECHNICIAN_PAYMENTS holder
    await page.goto("/finance", { waitUntil: "networkidle" });
    const transferRow = page.locator("li", { hasText: "222.00" }).filter({ hasText: "من عصام" });
    await transferRow.locator('button:has-text("تأكيد الاستلام")').click();
    await page.locator('[role="alertdialog"]').locator('button:has-text("تأكيد")').click();
    await page.waitForSelector("text=تم تأكيد الاستلام", { timeout: 10_000 });
    await page.waitForTimeout(400);

    expect(issamBefore - (await cashBalance(db, issamCash))).toBe(222);
    expect((await cashBalance(db, companyCash)) - companyBefore).toBe(222);
  });
});
