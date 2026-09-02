import {
  test,
  expect,
  createLeadJob,
  uniquePhone,
  uniqueLabel,
  demoUserId,
  revokePermission,
  grantPermission,
} from "./fixtures";

/**
 * Spec section 87: global search — finds a job by number, a customer by
 * name/phone, and is permission-scoped.
 *
 * globalSearch() (src/server/search.ts) applies the same per-user
 * involvement scoping as the /jobs list page: a VIEW_ASSIGNED_JOBS-only
 * (no VIEW_ALL_JOBS) viewer's job results are narrowed via the same
 * involvementFilter /jobs uses (measured/priced/closed the job, or
 * assigned to it) — so search cannot surface a job number, customer
 * name, or status for a job the viewer has no involvement in and
 * couldn't otherwise see. These tests assert: a user holding neither
 * VIEW_CUSTOMERS nor any job-view permission gets empty results (not an
 * error, not a leak of matching rows), and a user who holds
 * VIEW_ASSIGNED_JOBS but not VIEW_ALL_JOBS finds a matching job only
 * when actually involved in it — never one they aren't.
 */

test.describe("global search", () => {
  test("finds a job by its job number and a customer by name and by phone", async ({
    page,
    loginAs,
  }) => {
    await loginAs(page, "amr");
    const customerName = uniqueLabel("عميل بحث شامل");
    const customerPhone = uniquePhone();
    const job = await createLeadJob(page, {
      customerName,
      customerPhone,
      title: "اختبار البحث الشامل",
    });

    await page.goto(`/search?q=${encodeURIComponent(job.jobNumber)}`, { waitUntil: "networkidle" });
    let text = await page.innerText("body");
    expect(text).toContain(job.jobNumber);
    expect(text).toContain(customerName);

    await page.goto(`/search?q=${encodeURIComponent(customerName)}`, { waitUntil: "networkidle" });
    text = await page.innerText("body");
    expect(text).toContain(customerName);
    expect(text).toContain(customerPhone);

    await page.goto(`/search?q=${encodeURIComponent(customerPhone)}`, { waitUntil: "networkidle" });
    text = await page.innerText("body");
    expect(text).toContain(customerName);

    // Via the header search box + Enter, same as a real user's flow.
    await page.goto("/dashboard", { waitUntil: "networkidle" });
    await page.fill('input[placeholder*="بحث شامل"]', job.jobNumber);
    await Promise.all([
      page.waitForURL(/\/search\?q=/, { timeout: 10_000 }),
      page.keyboard.press("Enter"),
    ]);
    await page.waitForLoadState("networkidle");
    text = await page.innerText("body");
    expect(text).toContain(job.jobNumber);
  });

  test("a term under 2 characters returns no results (matches globalSearch's own guard, not an error page)", async ({
    page,
    loginAs,
  }) => {
    await loginAs(page, "amr");
    await page.goto("/search?q=a", { waitUntil: "networkidle" });
    const text = await page.innerText("body");
    expect(text).toContain("لا توجد نتائج مطابقة");
  });

  test("a user holding neither VIEW_CUSTOMERS nor any job-view permission gets empty search results, not an error or a leak", async ({
    page,
    loginAs,
    db,
  }) => {
    const baselId = await demoUserId(db, "basel");
    await revokePermission(db, baselId, "view_customers");
    await revokePermission(db, baselId, "view_assigned_jobs");
    try {
      await loginAs(page, "basel");
      // Search for Basel's own name — he definitely exists as a user, and
      // matching jobs/customers definitely exist — yet with neither view
      // permission the results must come back genuinely empty.
      await page.goto(`/search?q=${encodeURIComponent("باسل")}`, { waitUntil: "networkidle" });
      const text = await page.innerText("body");
      expect(text).toContain("لا توجد نتائج مطابقة");
    } finally {
      await grantPermission(db, baselId, "view_customers");
      await grantPermission(db, baselId, "view_assigned_jobs");
    }
  });

  test("a user holding VIEW_ASSIGNED_JOBS (but not VIEW_ALL_JOBS) finds a matching job by number only once actually involved in it — not before", async ({
    page,
    loginAs,
    db,
  }) => {
    await loginAs(page, "amr");
    const job = await createLeadJob(page, {
      customerName: uniqueLabel("عميل بحث غير مرتبط"),
      customerPhone: uniquePhone(),
      title: "اختبار نطاق البحث",
    });

    // Basel (seeded: VIEW_ASSIGNED_JOBS, not VIEW_ALL_JOBS) was never
    // assigned to this job at all — both the list page AND global search
    // must hide it.
    await loginAs(page, "basel");
    await page.goto("/jobs", { waitUntil: "networkidle" });
    await expect(page.getByText(job.jobNumber)).toHaveCount(0);

    await page.goto(`/search?q=${encodeURIComponent(job.jobNumber)}`, { waitUntil: "networkidle" });
    // The page always echoes the raw query back in its "نتائج البحث عن
    // ..." heading, so assert on the empty-state marker (which only
    // renders when both results arrays are empty) rather than searching
    // the whole body for the job number.
    let text = await page.innerText("body");
    expect(text).toContain("لا توجد نتائج مطابقة");
    await expect(page.getByRole("link", { name: job.jobNumber })).toHaveCount(0);

    // Now genuinely involve Basel (assigned to the job) — search must
    // start surfacing it, same as the list page would.
    const baselId = await demoUserId(db, "basel");
    await db.query(
      `insert into job_assignments (job_id, user_id, role) values ($1, $2, 'installer')`,
      [job.jobId, baselId],
    );
    try {
      await page.goto(`/search?q=${encodeURIComponent(job.jobNumber)}`, { waitUntil: "networkidle" });
      text = await page.innerText("body");
      expect(text).toContain(job.jobNumber);
    } finally {
      await db.query(`delete from job_assignments where job_id = $1 and user_id = $2`, [
        job.jobId,
        baselId,
      ]);
    }
  });
});
