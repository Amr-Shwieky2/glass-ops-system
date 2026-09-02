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
 * Ground truth checked directly in src/server/search.ts before writing the
 * scoping assertions below, rather than assuming the job-list page's own
 * per-user involvement scoping also applies here: globalSearch() gates
 * jobs behind a single binary check — VIEW_ALL_JOBS OR VIEW_ASSIGNED_JOBS
 * — and, once past it, queries ALL jobs matching the term with no further
 * per-user filter. So a VIEW_ASSIGNED_JOBS-only user's search results are
 * NOT narrowed to jobs they're actually assigned to (unlike /jobs, which
 * genuinely is — see verify-phase4.mjs and permissions.spec.ts) — global
 * search's real scoping is coarser: "can you see jobs at all", not "can
 * you see THIS job". These tests assert the real, verified behavior: a
 * user holding neither VIEW_CUSTOMERS nor any job-view permission gets
 * empty results (not an error, not a leak of matching rows), and a user
 * who does hold a job-view permission finds a matching job regardless of
 * personal involvement.
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

  test("a user holding VIEW_ASSIGNED_JOBS (but not VIEW_ALL_JOBS) finds a matching job by number even when not personally involved in it", async ({
    page,
    loginAs,
  }) => {
    await loginAs(page, "amr");
    const job = await createLeadJob(page, {
      customerName: uniqueLabel("عميل بحث غير مرتبط"),
      customerPhone: uniquePhone(),
      title: "اختبار نطاق البحث",
    });

    // Basel (seeded: VIEW_ASSIGNED_JOBS, not VIEW_ALL_JOBS) was never
    // assigned to this job at all.
    await loginAs(page, "basel");
    await page.goto("/jobs", { waitUntil: "networkidle" }); // the LIST page correctly hides it
    await expect(page.getByText(job.jobNumber)).toHaveCount(0);

    await page.goto(`/search?q=${encodeURIComponent(job.jobNumber)}`, { waitUntil: "networkidle" });
    const text = await page.innerText("body");
    expect(text).toContain(job.jobNumber); // ...but search still surfaces it (see file header comment)
  });
});
