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
  grantPermission,
  revokePermission,
} from "./fixtures";

/**
 * Signs a quote via its real public link — see the identical helper (and
 * its full rationale) in financial.spec.ts/production.spec.ts/
 * repairs.spec.ts. Duplicated locally per this codebase's own convention
 * for this exact helper rather than centralized in fixtures.ts.
 */
async function quoteAndSignQuote(page: import("@playwright/test").Page, price: string) {
  await page.click('button:has-text("إنشاء عرض سعر")');
  const dialog = page.locator('[role="dialog"]');
  await dialog.locator('input[placeholder="الوصف"]').fill("بند اختبار صلاحية السعر");
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
}

/**
 * Spec section 87: permission checks and unauthorized financial access.
 *
 * Reuses the exact scenarios already proven in scripts/verify-phase7.mjs
 * (Part D — zero scheduling permission), verify-phase8.mjs (Parts F/H/I —
 * job-cost approval gating, financial-visibility DOM-absence, technician
 * ledger Forbidden), verify-phase6.mjs (Part B — /production Forbidden)
 * and verify-phase4.mjs (uninvolved-job isolation) as the reference for
 * which checks matter most, rewritten as independent Playwright tests
 * against freshly created jobs (never the shared seeded ones) so the
 * suite can be re-run repeatedly without corrupting other phases' fixtures.
 *
 * Every test that temporarily revokes a seeded demo user's permission
 * restores it in a `finally` block, mirroring the established
 * verify-phaseN.mjs revoke -> assert -> restore pattern. Because
 * playwright.config.ts pins this suite to a single worker (see its own
 * comment), these revoke/restore windows on the SHARED demo users never
 * race against another test.
 */

test.describe("permission-gated UI (DOM absence, not just hidden)", () => {
  test("a user holding none of the four scheduling permissions has no 'جدولة موعد' trigger, even on a job they're involved in", async ({
    page,
    loginAs,
    db,
  }) => {
    const baselId = await demoUserId(db, "basel");

    await loginAs(page, "mohammad");
    const job = await createLeadJob(page, {
      customerName: uniqueLabel("عميل صلاحيات"),
      customerPhone: uniquePhone(),
      title: "اختبار صلاحية الجدولة",
    });
    // Make Basel genuinely "involved" in the job (assigned as installer),
    // via ASSIGN_INSTALLER (Mohammad holds it) — job.assignments is the
    // job-detail page's own involvement check.
    await page.click('button:has-text("تعيين فني")');
    const assignDialog = page.locator('[role="dialog"]');
    await assignDialog.locator("#userId").click();
    await page.locator(`[role="option"]:has-text("${DEMO_USERS.basel.name}")`).click();
    await assignDialog.locator('button:has-text("تعيين"):not(:has-text("فني"))').click();
    await page.waitForTimeout(500);

    // Basel seeded holds CREATE_MEASUREMENT and CREATE_REPAIR — both of
    // which independently qualify for the scheduling trigger — so both
    // must be stripped to reach true zero-of-four.
    await revokePermission(db, baselId, "create_measurement");
    await revokePermission(db, baselId, "create_repair");
    try {
      await loginAs(page, "basel");
      await page.goto(job.href, { waitUntil: "networkidle" });
      await expect(page.locator("h1", { hasText: job.jobNumber })).toBeVisible();
      await expect(page.locator('button:has-text("جدولة موعد")')).toHaveCount(0);
    } finally {
      await grantPermission(db, baselId, "create_measurement");
      await grantPermission(db, baselId, "create_repair");
    }

    // Restore actually took effect (permissions are read fresh per request).
    await page.goto(job.href, { waitUntil: "networkidle" });
    await expect(page.locator('button:has-text("جدولة موعد")')).toHaveCount(1);
  });

  test("Costs and Compensation sections are genuinely absent for a user lacking every qualifying financial permission, even on a job they're involved in", async ({
    page,
    loginAs,
  }) => {
    await loginAs(page, "mohammad");
    const job = await createLeadJob(page, {
      customerName: uniqueLabel("عميل تكاليف"),
      customerPhone: uniquePhone(),
      title: "اختبار إخفاء التكاليف",
    });
    await page.click('button:has-text("تعيين فني")');
    const assignDialog = page.locator('[role="dialog"]');
    await assignDialog.locator("#userId").click();
    await page.locator(`[role="option"]:has-text("${DEMO_USERS.basel.name}")`).click();
    await assignDialog.locator('button:has-text("تعيين"):not(:has-text("فني"))').click();
    await page.waitForTimeout(500);

    // Basel (seeded) holds none of VIEW_JOB_COSTS / VIEW_PROFITABILITY /
    // VIEW_TECHNICIAN_BALANCES / MANAGE_TECHNICIAN_PAYMENTS.
    await loginAs(page, "basel");
    await page.goto(job.href, { waitUntil: "networkidle" });
    await expect(page.locator("h1", { hasText: job.jobNumber })).toBeVisible();
    await expect(page.locator('[data-slot="card"]', { hasText: "التكاليف" })).toHaveCount(0);
    await expect(page.locator('[data-slot="card"]', { hasText: "تعويض الفنيين" })).toHaveCount(0);
  });

  test("/production is Forbidden for a user without CREATE_PRODUCTION_ORDER/APPROVE_FACTORY_PRICE", async ({
    page,
    loginAs,
  }) => {
    await loginAs(page, "basel");
    await page.goto("/production", { waitUntil: "networkidle" });
    await expect(page.getByText("لا تملك صلاحية الوصول لهذه الصفحة")).toBeVisible();
  });
});

test.describe("unauthorized financial data access", () => {
  test("a user without VIEW_TECHNICIAN_BALANCES cannot open another technician's ledger page (Forbidden, no data leak)", async ({
    page,
    loginAs,
    db,
  }) => {
    const issamId = await demoUserId(db, "issam");

    await loginAs(page, "basel");
    await page.goto(`/finance/technicians/${issamId}`, { waitUntil: "networkidle" });
    const text = await page.innerText("body");
    expect(text).toContain("لا تملك صلاحية الوصول لهذه الصفحة");
    expect(text).not.toContain("الرصيد المستحق");
    expect(text).not.toContain("سجل الحركات");
  });

  test("the technician roster redirects a user without VIEW_TECHNICIAN_BALANCES straight to their own ledger, never the full roster", async ({
    page,
    loginAs,
    db,
  }) => {
    const baselId = await demoUserId(db, "basel");
    await loginAs(page, "basel");
    await page.goto("/finance/technicians", { waitUntil: "networkidle" });
    expect(new URL(page.url()).pathname).toBe(`/finance/technicians/${baselId}`);
  });

  test("a job cost stays pending and hidden from decision controls without APPROVE_REQUESTS, and is only decidable once granted", async ({
    page,
    loginAs,
    db,
  }) => {
    const mohammadId = await demoUserId(db, "mohammad");

    await loginAs(page, "mohammad");
    const job = await createLeadJob(page, {
      customerName: uniqueLabel("عميل تكلفة معلقة"),
      customerPhone: uniquePhone(),
      title: "اختبار اعتماد تكلفة",
    });

    await revokePermission(db, mohammadId, "approve_requests");
    try {
      // Mohammad still holds MANAGE_JOB_COSTS, so re-request the job page
      // fresh (permissions are read per request, not cached in the page).
      await page.goto(job.href, { waitUntil: "networkidle" });
      const costsCard = page.locator('[data-slot="card"]', { hasText: "التكاليف" });
      await expect(costsCard.locator('button:has-text("إضافة تكلفة")')).toHaveCount(1);

      await costsCard.locator('button:has-text("إضافة تكلفة")').click();
      const dialog = page.locator('[role="dialog"]');
      await dialog.locator("#amount").fill("275");
      await dialog.locator("#description").fill("اختبار صلاحيات — تكلفة معلقة");
      await dialog.locator('button:has-text("إضافة التكلفة")').click();
      await page.waitForSelector("text=تم تسجيل التكلفة", { timeout: 10_000 });
      await page.waitForTimeout(400);

      await page.reload({ waitUntil: "networkidle" });
      const costsCardAfter = page.locator('[data-slot="card"]', { hasText: "التكاليف" });
      await expect(costsCardAfter.locator('button:has-text("اعتماد")')).toHaveCount(0);
      await expect(costsCardAfter.locator('button:has-text("رفض")')).toHaveCount(0);

      const { rows: pendingRows } = await db.query(
        `select status from job_costs where job_id = $1 and amount = '275.00'`,
        [job.jobId],
      );
      expect(pendingRows[0]?.status).toBe("pending");
    } finally {
      await grantPermission(db, mohammadId, "approve_requests");
    }

    // Mohammad himself created this cost — even with approve_requests
    // restored, he cannot decide his own request (master prompt section 9:
    // requester != approver). The decision controls must not even appear
    // for him.
    await page.goto(job.href, { waitUntil: "networkidle" });
    const costsCardOwn = page.locator('[data-slot="card"]', { hasText: "التكاليف" });
    await expect(costsCardOwn.locator('button:has-text("اعتماد")')).toHaveCount(0);
    await expect(costsCardOwn.locator('button:has-text("رفض")')).toHaveCount(0);

    // A different APPROVE_REQUESTS holder (the super admin) can decide it.
    await loginAs(page, "amr");
    await page.goto(job.href, { waitUntil: "networkidle" });
    const costsCardRestored = page.locator('[data-slot="card"]', { hasText: "التكاليف" });
    await expect(costsCardRestored.locator('button:has-text("اعتماد")')).toHaveCount(1);
    await costsCardRestored.locator('button:has-text("اعتماد")').first().click();
    await page.locator('[role="alertdialog"]').locator('button:has-text("اعتماد")').click();
    await page.waitForSelector("text=تم اعتماد التكلفة", { timeout: 10_000 });

    const { rows: approvedRows } = await db.query(
      `select status, approved_by_user_id from job_costs where job_id = $1 and amount = '275.00'`,
      [job.jobId],
    );
    expect(approvedRows[0]?.status).toBe("approved");
    expect(approvedRows[0]?.approved_by_user_id).not.toBe(mohammadId);
  });

  test("an assigned installer with no VIEW_SALE_PRICE cannot retrieve the sale price — server responses, not just hidden UI", async ({
    page,
    loginAs,
    db,
  }) => {
    await loginAs(page, "mohammad");
    const job = await createLeadJob(page, {
      customerName: uniqueLabel("عميل سعر بيع"),
      customerPhone: uniquePhone(),
      title: "اختبار حجب سعر البيع",
    });
    await quoteAndSignQuote(page, "7500");

    await page.click('button:has-text("تعيين فني")');
    const assignDialog = page.locator('[role="dialog"]');
    await assignDialog.locator("#userId").click();
    await page.locator(`[role="option"]:has-text("${DEMO_USERS.basel.name}")`).click();
    await assignDialog.locator('button:has-text("تعيين"):not(:has-text("فني"))').click();
    await page.waitForTimeout(500);

    // Collect a partial payment first (1,000 of 7,500) so "remaining"
    // (6,500 — legitimately visible to a COLLECT_PAYMENT holder like
    // Basel, a DIFFERENT concern from the agreed sale price itself, see
    // R1.41) never coincidentally equals the sale-price figure this test
    // is actually checking for. Mohammad's own payment lands pending
    // (requester != approver, see the financial.spec.ts test of the same
    // rule) so Amr approves it as a distinct decider.
    await page.click('button:has-text("إضافة دفعة")');
    const payDialog = page.locator('[role="dialog"]');
    await payDialog.locator("#amount").fill("1000");
    await payDialog.locator('button:has-text("إضافة الدفعة")').click();
    await page.waitForSelector("text=تم تسجيل الدفعة", { timeout: 10_000 });
    await page.waitForTimeout(400);

    await loginAs(page, "amr");
    await page.goto(job.href, { waitUntil: "networkidle" });
    await page.click('button:has-text("اعتماد")');
    await page.locator('[role="alertdialog"]').locator('button:has-text("اعتماد")').click();
    await page.waitForSelector("text=تم اعتماد الدفعة", { timeout: 10_000 });
    await page.waitForTimeout(400);

    const { rows: jobRows } = await db.query(
      `select customer_id from jobs where id = $1`,
      [job.jobId],
    );
    const customerId = jobRows[0].customer_id as string;
    const { rows: quoteRows } = await db.query(
      `select id from quotes where job_id = $1 limit 1`,
      [job.jobId],
    );
    const quoteId = quoteRows[0].id as string;

    // Basel (seeded: no VIEW_SALE_PRICE) is now genuinely assigned/involved
    // in this job — an easy case to get right by accident via a broad
    // "not involved" check. The real assertion is that the price is gone
    // from the RAW response body (a Server Component streams its props
    // straight into the HTML/RSC payload — hiding a value with CSS or a
    // client-side check would still leak it here), not merely invisible.
    await loginAs(page, "basel");
    const jobPageResp = await page.request.get(job.href);
    expect(jobPageResp.status()).toBe(200);
    const jobPageBody = await jobPageResp.text();
    expect(jobPageBody).not.toMatch(moneyPattern("7500.00"));
    expect(jobPageBody).not.toContain("قيمة البيع الإجمالية");

    // /jobs list: same job, same missing figure, and the column itself
    // must be gone (not merely an empty cell an attacker could still
    // infer structure from).
    const jobsListResp = await page.request.get("/jobs");
    expect(jobsListResp.status()).toBe(200);
    const jobsListBody = await jobsListResp.text();
    expect(jobsListBody).not.toMatch(moneyPattern("7500.00"));
    expect(jobsListBody).not.toContain("قيمة البيع");

    // The customer page IS reachable (Basel is genuinely involved via this
    // job's assignment) — but the price on it must still be withheld.
    const customerPageResp = await page.request.get(`/customers/${customerId}`);
    expect(customerPageResp.status()).toBe(200);
    const customerPageBody = await customerPageResp.text();
    expect(customerPageBody).not.toMatch(moneyPattern("7500.00"));

    // The internal quote PDF is a pricing document — job involvement alone
    // must not be enough to fetch it.
    const quotePdfResp = await page.request.get(`/api/quotes/${quoteId}/pdf`);
    expect(quotePdfResp.status()).toBe(403);
  });
});

test.describe("job-visibility isolation", () => {
  test("a restricted user's job list excludes an uninvolved job, and direct navigation to it shows Forbidden without leaking any job data", async ({
    page,
    loginAs,
  }) => {
    await loginAs(page, "mohammad");
    const uninvolved = await createLeadJob(page, {
      customerName: uniqueLabel("عميل غير مرتبط ببازل"),
      customerPhone: uniquePhone(),
      title: "اختبار عزل الرؤية",
    });

    await loginAs(page, "basel");
    await page.goto("/jobs", { waitUntil: "networkidle" });
    await expect(page.getByText(uninvolved.jobNumber)).toHaveCount(0);

    await page.goto(uninvolved.href, { waitUntil: "networkidle" });
    const text = await page.innerText("body");
    expect(text).toContain("لا تملك صلاحية الوصول");
    expect(text).not.toContain(uninvolved.jobNumber);
  });
});
