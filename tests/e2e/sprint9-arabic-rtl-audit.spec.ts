import { test, expect, createLeadJob, uniquePhone, uniqueLabel } from "./fixtures";

/**
 * Sprint 9 regression coverage: a genuine full Arabic/RTL audit, not a
 * re-run of the earlier sweep. The audit trail (src/app/(app)/admin/
 * audit-log/page.tsx) is the headline item — explicitly named in the
 * master project instructions ("audit actions") — which previously
 * rendered raw English action keys (e.g. "job.create"), raw English
 * entity-type strings, and a raw English-keyed JSON diff directly to an
 * Arabic-speaking admin. The Asia/Jerusalem business-date fixes (5
 * call sites that each independently reimplemented, and got wrong, the
 * UTC-vs-local-day computation src/lib/company-day.ts already solves) are
 * covered by unit tests (company-day.test.ts, due-soon.test.ts) rather
 * than here — pure date-boundary logic is far more precisely and quickly
 * verified at that level than through a live page render.
 */

test.describe("Sprint 9 — audit log translation", () => {
  test("the audit log shows Arabic action/entity labels and a translated change-diff, never the raw English action key, entity type, or JSON field names", async ({
    page,
    loginAs,
  }) => {
    await loginAs(page, "mohammad");
    const customerName = uniqueLabel("عميل سجل التدقيق");
    const job = await createLeadJob(page, {
      customerName,
      customerPhone: uniquePhone(),
      title: "اختبار ترجمة سجل التدقيق",
    });

    await loginAs(page, "amr"); // the only demo persona holding VIEW_AUDIT_LOG
    await page.goto("/admin/audit-log", { waitUntil: "networkidle" });

    const row = page.locator("tr", { has: page.locator(`a[href="${job.href}"]`) }).first();
    await expect(row).toBeVisible();

    // The action/entity cells must show the translated Arabic label, never
    // the raw dotted/underscored English key this sprint's fix replaced.
    await expect(row).toContainText("إنشاء مهمة");
    await expect(row).not.toContainText("job.create");
    await expect(row).toContainText("مهمة");
    await expect(row).not.toContainText(/\bjob\b/);

    await row.locator('text=عرض التغييرات').click();
    const diffText = await row.innerText();
    // The wrapper keys are translated ("قبل"/"بعد"), not the raw English
    // "old"/"new" this sprint's fix replaced.
    expect(diffText).toContain("قبل");
    expect(diffText).toContain("بعد");
    expect(diffText).not.toMatch(/"old"\s*:/);
    expect(diffText).not.toMatch(/"new"\s*:/);
    // The job number field name is translated too, not the raw camelCase
    // DB column name.
    expect(diffText).toContain("رقم المهمة");
    expect(diffText).not.toContain("jobNumber");
    expect(diffText).toContain(job.jobNumber);
  });

  test("the entity-type filter dropdown and the results table use the exact same Arabic label set — no longer a translated filter over an untranslated table", async ({
    page,
    loginAs,
  }) => {
    await loginAs(page, "amr");
    await page.goto("/admin/audit-log", { waitUntil: "networkidle" });

    // src/lib/audit-labels.ts is now the single shared source for both —
    // before this sprint, audit-filters.tsx had its own private copy of
    // this exact list that the results table never consulted.
    await page.locator("form button", { hasText: "كل الأنواع" }).click();
    const options = page.locator('[role="option"]');
    await expect(options.filter({ hasText: "مهمة" }).first()).toBeVisible();
    await expect(options.filter({ hasText: "دفعة عميل" }).first()).toBeVisible();
    await page.keyboard.press("Escape");

    const tableText = await page.locator("table").innerText();
    // Every row's entity column comes from the same map — spot-check that
    // no raw snake_case entity type leaked through anywhere on the page.
    expect(tableText).not.toMatch(/\bcustomer_payment\b/);
    expect(tableText).not.toMatch(/\bjob_cost\b/);
  });
});
