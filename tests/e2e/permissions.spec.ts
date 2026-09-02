import {
  test,
  expect,
  DEMO_USERS,
  createLeadJob,
  uniquePhone,
  uniqueLabel,
  demoUserId,
  grantPermission,
  revokePermission,
} from "./fixtures";

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
    expect(approvedRows[0]?.approved_by_user_id).toBe(mohammadId);
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
