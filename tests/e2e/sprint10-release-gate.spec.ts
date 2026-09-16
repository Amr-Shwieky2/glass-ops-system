import { test, expect } from "./fixtures";

/**
 * Sprint 10 regression coverage: the full release gate. Most of this
 * sprint's verification (Docker build/up/migrate/healthcheck, the
 * scheduler's internal + container-network auth, a real backup ->
 * mutate -> restore -> confirm-reverted cycle, the Ahmad scenario's
 * financial totals checked directly against the database) was performed
 * live and is documented in the Sprint 10 changelog entry rather than
 * re-encoded here — a shell/Docker lifecycle isn't something this
 * Playwright suite can meaningfully assert on. What IS suited to a
 * regression test is the one genuine, live-reproduced BROKEN item this
 * sprint found and fixed: no localized not-found.tsx/error.tsx existed
 * anywhere in the app, so a stale or mistyped link — routine in a
 * field-service app shared over WhatsApp/SMS — dropped the user into
 * Next.js's default, unstyled, English 404, breaking out of an
 * otherwise 100%-Arabic-RTL app with no way back in.
 */

test.describe("Sprint 10 — release gate: localized 404", () => {
  test("a nonexistent job UUID renders the app's own Arabic 404 page, not Next.js's default English one", async ({
    page,
    loginAs,
  }) => {
    await loginAs(page, "amr");
    await page.goto("/jobs/00000000-0000-0000-0000-000000000000", {
      waitUntil: "networkidle",
    });

    const bodyText = await page.innerText("body");
    expect(bodyText).toContain("الصفحة غير موجودة");
    expect(bodyText).not.toContain("This page could not be found");

    await page.click('a:has-text("العودة إلى الصفحة الرئيسية")');
    await page.waitForURL("**/dashboard", { timeout: 10_000 });
  });

  test("a nonexistent customer UUID also renders the same localized 404 (not-found.tsx is app-wide, not route-specific)", async ({
    page,
    loginAs,
  }) => {
    await loginAs(page, "amr");
    await page.goto("/customers/00000000-0000-0000-0000-000000000000", {
      waitUntil: "networkidle",
    });

    const bodyText = await page.innerText("body");
    expect(bodyText).toContain("الصفحة غير موجودة");
  });
});
