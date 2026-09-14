import {
  test,
  expect,
  createLeadJob,
  drawSignature,
  moneyPattern,
  uniquePhone,
  uniqueLabel,
  demoUserId,
  revokePermission,
  grantPermission,
} from "./fixtures";

/**
 * Spec section 87: factory approval and job-cost approval.
 *
 * Drives a fresh job all the way from lead -> signed quote -> auto-converted
 * job -> auto-sent to the factory over its own public (tokenless) link ->
 * submitted -> rejected -> resubmitted -> approved, then confirms the
 * resulting job_costs row directly (category='factory_glass',
 * status='approved'), mirroring scripts/verify-phase6.mjs's real flow.
 *
 * The customer's own signature now runs the auto-convert-to-job and
 * auto-send-to-factory cascade (see src/server/quotes/actions.ts's
 * runPostSignAutomation) in one best-effort sequence right after the
 * signature transaction commits — so quoteAndSignQuote below no longer
 * clicks "تحويل إلى مهمة" or "إرسال إلى المصنع" itself; by the time it
 * returns, both have already happened automatically and the job is already
 * sitting in in_production with a production request + factory link. The
 * manual buttons themselves (still the required fallback per this feature's
 * design) get their own direct, unchanged coverage via
 * convertQuoteToJob/sendToFactoryAction called outside the UI in
 * tests/e2e/quotes.spec.ts and scripts/verify-req5-auto-routing.mjs — this
 * file no longer needs to duplicate that.
 *
 * A separate test covers a general (non-factory) job cost's two-step
 * approval gate (MANAGE_JOB_COSTS to create it, APPROVE_REQUESTS to decide
 * it — two independent permissions, per src/server/costs/actions.ts).
 */

async function quoteAndSignQuote(
  page: import("@playwright/test").Page,
  price: string,
  itemLabel: string,
) {
  await page.click('button:has-text("إنشاء عرض سعر")');
  const dialog = page.locator('[role="dialog"]');
  await dialog.locator('input[placeholder="الوصف"]').fill(itemLabel);
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

  // The signature above already ran the full auto-convert + auto-send
  // cascade server-side. Reload and confirm neither manual button is
  // present any more (their step is already done) before the job is at
  // in_production with an auto-created production request + factory link.
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.locator('button:has-text("تحويل العرض إلى مهمة")')).toHaveCount(0);
  await expect(page.locator('button:has-text("إرسال إلى المصنع")')).toHaveCount(0);
  const text = await page.innerText("body");
  expect(text).toContain("قيد الإنتاج");
}

/** Pulls the auto-created factory link out of the already-visible "رابط
 * المصنع" (show factory link) button — the automation issued this link
 * itself, there is no send dialog left to read it from. */
async function readAutoFactoryLink(page: import("@playwright/test").Page): Promise<string> {
  await page.click('button:has-text("رابط المصنع")');
  const dialog = page.locator('[role="dialog"]');
  const link = await dialog.locator("input[readonly]").inputValue();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  return link;
}

test.describe("factory production approval", () => {
  test("factory submits via its public link (no login) -> rejected -> resubmitted -> approved -> booked as an approved job_costs row", async ({
    page,
    loginAs,
    db,
  }) => {
    await loginAs(page, "mohammad");
    const job = await createLeadJob(page, {
      customerName: uniqueLabel("عميل مصنع"),
      customerPhone: uniquePhone(),
      title: "اختبار موافقة المصنع",
    });
    await quoteAndSignQuote(page, "1400", "زجاج شرفة — اختبار إنتاج");
    let text = await page.innerText("body");
    // The auto-created production request's details text is built the same
    // way the manual dialog used to prefill it (summarizeJobItemsFor
    // AutoFactory mirrors summarizeJobItemsForFactory) — it already
    // mentions the signed quote's item, right there on the job page.
    expect(text).toContain("زجاج شرفة");

    const factoryLink = await readAutoFactoryLink(page);
    expect(factoryLink).toMatch(/\/public\/pr\//);

    // The factory submits over the bare public link — a completely
    // separate, cookie-less browser context, no employee session at all.
    const factoryCtx = await page.context().browser()!.newContext({ locale: "ar" });
    const factoryPage = await factoryCtx.newPage();
    await factoryPage.goto(factoryLink, { waitUntil: "networkidle" });
    text = await factoryPage.innerText("body");
    expect(text).toContain(job.jobNumber);
    await factoryPage.fill("#submittedPrice", "1650");
    await factoryPage.locator('button:has-text("إرسال السعر")').click();
    await factoryPage.waitForSelector("text=تم استلام عرضكم", { timeout: 10_000 });

    // Reject it — job status must NOT roll back.
    await page.goto(job.href, { waitUntil: "networkidle" });
    text = await page.innerText("body");
    expect(moneyPattern("1650.00").test(text)).toBe(true);
    await page.click('button:has-text("رفض")');
    const rejectDialog = page.locator('[role="dialog"]');
    const rejectionReason = "السعر أعلى من الميزانية المتفق عليها.";
    await rejectDialog.locator("#rejectionReason").fill(rejectionReason);
    await rejectDialog.locator('button:has-text("تأكيد الرفض")').click();
    await page.waitForTimeout(700);
    text = await page.innerText("body");
    expect(text).toContain("تم رفض هذا العرض");
    expect(text).toContain("قيد الإنتاج"); // status held, not rolled back

    const { rows: jobCostsAfterReject } = await db.query(
      `select status from job_costs where job_id = $1`,
      [job.jobId],
    );
    expect(jobCostsAfterReject).toHaveLength(0); // a rejected submission books nothing

    // Factory sees the rejection and resubmits.
    await factoryPage.goto(factoryLink, { waitUntil: "networkidle" });
    text = await factoryPage.innerText("body");
    expect(text).toContain(rejectionReason);
    await factoryPage.fill("#submittedPrice", "1500");
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
    text = await page.innerText("body");
    expect(text).toContain("تم اعتماد هذا السعر");
    expect(text).toContain("جاهز من المصنع");

    const { rows: bookedCost } = await db.query(
      `select amount, category, status from job_costs where job_id = $1`,
      [job.jobId],
    );
    expect(bookedCost).toHaveLength(1);
    expect(bookedCost[0].amount).toBe("1500.00");
    expect(bookedCost[0].category).toBe("factory_glass");
    expect(bookedCost[0].status).toBe("approved");
  });

  test("a user without APPROVE_FACTORY_PRICE cannot decide a submitted price, even though assigned to the job", async ({
    page,
    loginAs,
  }) => {
    await loginAs(page, "mohammad");
    const job = await createLeadJob(page, {
      customerName: uniqueLabel("عميل تفويض مصنع"),
      customerPhone: uniquePhone(),
      title: "اختبار صلاحية اعتماد المصنع",
    });
    await quoteAndSignQuote(page, "900", "ألمنيوم — اختبار صلاحيات");

    // Installer assignment stays manual and independent of the new
    // auto-convert/auto-send cascade (per this feature's own design) — it
    // still works exactly as before on a job that's already in_production.
    await page.click('button:has-text("تعيين فني")');
    const assignDialog = page.locator('[role="dialog"]');
    await assignDialog.locator("#userId").click();
    await page.locator('[role="option"]:has-text("باسل")').click();
    await assignDialog.locator('button:has-text("تعيين"):not(:has-text("فني"))').click();
    await page.waitForTimeout(500);

    const factoryLink = await readAutoFactoryLink(page);

    const factoryCtx = await page.context().browser()!.newContext({ locale: "ar" });
    const factoryPage = await factoryCtx.newPage();
    await factoryPage.goto(factoryLink, { waitUntil: "networkidle" });
    await factoryPage.fill("#submittedPrice", "950");
    await factoryPage.locator('button:has-text("إرسال السعر")').click();
    await factoryPage.waitForSelector("text=تم استلام عرضكم", { timeout: 10_000 });
    await factoryCtx.close();

    await loginAs(page, "basel"); // seeded: no CREATE_PRODUCTION_ORDER/APPROVE_FACTORY_PRICE
    await page.goto(job.href, { waitUntil: "networkidle" });
    const text = await page.innerText("body");
    expect(text).toContain(job.jobNumber); // still involved, can open it
    await expect(page.locator('button:has-text("اعتماد السعر")')).toHaveCount(0);
    await expect(page.locator('button:has-text("رفض")')).toHaveCount(0);
  });
});

test.describe("general job cost approval (non-factory)", () => {
  test("MANAGE_JOB_COSTS creates a pending cost; only a separate APPROVE_REQUESTS holder can approve it", async ({
    page,
    loginAs,
    db,
  }) => {
    const mohammadId = await demoUserId(db, "mohammad");
    const amrId = await demoUserId(db, "amr");

    await loginAs(page, "mohammad");
    const job = await createLeadJob(page, {
      customerName: uniqueLabel("عميل تكلفة عامة"),
      customerPhone: uniquePhone(),
      title: "اختبار تكلفة عامة",
    });

    // Mohammad holds MANAGE_JOB_COSTS but, for this test, not
    // APPROVE_REQUESTS — the two permissions are independent by design.
    await revokePermission(db, mohammadId, "approve_requests");
    try {
      await page.goto(job.href, { waitUntil: "networkidle" });
      const costsCard = page.locator('[data-slot="card"]', { hasText: "التكاليف" });
      await costsCard.locator('button:has-text("إضافة تكلفة")').click();
      const dialog = page.locator('[role="dialog"]');
      await dialog.locator("#amount").fill("640");
      await dialog.locator("#description").fill("مواد وتجهيزات — اختبار موافقة عامة");
      await dialog.locator('button:has-text("إضافة التكلفة")').click();
      await page.waitForSelector("text=تم تسجيل التكلفة", { timeout: 10_000 });

      const { rows } = await db.query(
        `select status, created_by_user_id from job_costs where job_id = $1`,
        [job.jobId],
      );
      expect(rows[0].status).toBe("pending");
      expect(rows[0].created_by_user_id).toBe(mohammadId);
    } finally {
      await grantPermission(db, mohammadId, "approve_requests");
    }

    // Amr (APPROVE_REQUESTS holder) approves it.
    await loginAs(page, "amr");
    await page.goto(job.href, { waitUntil: "networkidle" });
    const costsCard = page.locator('[data-slot="card"]', { hasText: "التكاليف" });
    await costsCard.locator('button:has-text("اعتماد")').first().click();
    await page.locator('[role="alertdialog"]').locator('button:has-text("اعتماد")').click();
    await page.waitForSelector("text=تم اعتماد التكلفة", { timeout: 10_000 });

    const { rows: approved } = await db.query(
      `select status, approved_by_user_id from job_costs where job_id = $1`,
      [job.jobId],
    );
    expect(approved[0].status).toBe("approved");
    expect(approved[0].approved_by_user_id).toBe(amrId);
  });
});
