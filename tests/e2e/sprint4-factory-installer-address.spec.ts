import {
  test,
  expect,
  createLeadJob,
  drawSignature,
  uniquePhone,
  uniqueLabel,
  demoUserId,
} from "./fixtures";
import type { Page } from "@playwright/test";

/**
 * Sprint 4 regression coverage: (1) signing-time address/location
 * propagation into the operational Job, (2) real production-relevant
 * measurement attachments served through a factory-token-scoped route
 * (replacing the old "راجع صفحة المهمة" text-only mention an unauthenticated
 * factory contact could never actually act on), and (3) the installer side
 * of post-signing automation — a "Needs Installer Assignment" attention
 * item plus a direct notification, branching on whether job_assignments
 * already has someone on the job by the time it reaches ready_from_factory.
 */

// Same 1x1 PNG placeholder used by new-measurement.spec.ts / seed.ts as a
// stand-in for "a real, decodable image file".
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const TINY_PNG_BUFFER = Buffer.from(TINY_PNG_BASE64, "base64");

/** Fills out and submits /my-day/new-measurement exactly like a field
 * technician, returning the new job's id. Caller must already be logged in
 * as a CREATE_MEASUREMENT holder. */
async function submitFieldMeasurementWithAttachment(
  page: Page,
  opts: { phone: string; customerName: string; fileName?: string },
): Promise<string> {
  await page.goto("/my-day/new-measurement", { waitUntil: "networkidle" });
  await page.fill("#phone", opts.phone);
  await page.fill("#customerName", opts.customerName);
  await page.setInputFiles("#files", [
    {
      name: opts.fileName ?? "site-photo.png",
      mimeType: "image/png",
      buffer: TINY_PNG_BUFFER,
    },
  ]);
  await Promise.all([
    page.waitForURL(/\/jobs\/[0-9a-fA-F-]{36}$/, { timeout: 15_000 }),
    page.click('button:has-text("إرسال القياس")'),
  ]);
  await page.waitForSelector("text=تم إرسال القياس الميداني بنجاح", { timeout: 10_000 });
  return new URL(page.url()).pathname.split("/").pop()!;
}

/** Sends the currently-open job page's job to the factory via the real
 * "إرسال إلى المصنع" dialog and returns the auto-revealed public link.
 * Caller must already be on the job's page, logged in as a
 * CREATE_PRODUCTION_ORDER holder — sendToFactoryAction has no job-status
 * prerequisite (see production-section.tsx), so this works on a job at any
 * non-terminal status. */
async function sendToFactory(page: Page, details: string): Promise<string> {
  await page.click('button:has-text("إرسال إلى المصنع")');
  const dialog = page.locator('[role="dialog"]');
  await dialog.locator("#details").fill(details);
  await dialog.locator('button:has-text("إرسال إلى المصنع")').click();
  await page.waitForSelector("text=تم إنشاء طلب الإنتاج", { timeout: 10_000 });
  const link = await dialog.locator("input[readonly]").inputValue();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  return link;
}

/** Submits a price over the factory's own public (no-login) link and
 * approves it as the currently logged-in page (must hold
 * APPROVE_FACTORY_PRICE), mirroring production.spec.ts's own flow. */
async function submitAndApproveFactoryPrice(
  page: Page,
  factoryLink: string,
  jobHref: string,
): Promise<void> {
  const factoryCtx = await page.context().browser()!.newContext({ locale: "ar" });
  const factoryPage = await factoryCtx.newPage();
  await factoryPage.goto(factoryLink, { waitUntil: "networkidle" });
  await factoryPage.fill("#submittedPrice", "1200");
  await factoryPage.locator('button:has-text("إرسال السعر")').click();
  await factoryPage.waitForSelector("text=تم استلام عرضكم", { timeout: 10_000 });
  await factoryCtx.close();

  await page.goto(jobHref, { waitUntil: "networkidle" });
  await page.click('button:has-text("اعتماد السعر")');
  await page
    .locator('[role="alertdialog"]')
    .locator('button:has-text("اعتماد"):not(:has-text("السعر"))')
    .click();
  await page.waitForSelector("text=تم اعتماد هذا السعر", { timeout: 10_000 });
}

test.describe("Sprint 4 — signing address propagation, factory attachments, installer dispatch", () => {
  test("signing a quote propagates the confirmed installation address and coordinates into the job, without altering the immutable signature record", async ({
    page,
    loginAs,
    db,
  }) => {
    await loginAs(page, "mohammad");
    const job = await createLeadJob(page, {
      customerName: uniqueLabel("عميل عنوان"),
      customerPhone: uniquePhone(),
      title: "اختبار نقل العنوان عند التوقيع",
    });

    await page.click('button:has-text("إنشاء عرض سعر")');
    const dialog = page.locator('[role="dialog"]');
    await dialog.locator('input[placeholder="الوصف"]').fill("زجاج اختبار العنوان");
    await dialog.locator('input[placeholder="الكمية"]').fill("1");
    await dialog.locator('input[placeholder="السعر"]').fill("900");
    await dialog.locator('button:has-text("حفظ عرض السعر")').click();
    await page.waitForTimeout(700);

    await page.click('button:has-text("إرسال للعميل")');
    await page.waitForSelector("text=رابط توقيع العرض جاهز", { timeout: 10_000 });
    const link = await page.locator("input[readonly]").inputValue();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    const signingAddress = uniqueLabel("شارع الاختبار، حيفا");
    const latitude = 32.0741;
    const longitude = 34.7922;

    const customerCtx = await page.context().browser()!.newContext({
      locale: "ar",
      geolocation: { latitude, longitude },
      permissions: ["geolocation"],
    });
    const customerPage = await customerCtx.newPage();
    await customerPage.goto(link, { waitUntil: "networkidle" });
    await customerPage.fill("#customerNationalIdAtSigning", "302345678");
    await customerPage.fill("#customerAddressAtSigning", signingAddress);
    // Give the page's own navigator.geolocation.getCurrentPosition callback
    // a moment to populate the hidden latitude/longitude fields before
    // submitting (sign-form.tsx fires this on mount, not on submit).
    await customerPage.waitForTimeout(1000);
    await drawSignature(customerPage);
    await customerPage.check("#agreedToTerms");
    await customerPage.locator('button:has-text("توقيع والموافقة على العرض")').click();
    await customerPage.waitForSelector("text=تم توقيع عرض السعر", { timeout: 10_000 });
    await customerCtx.close();

    // The automation (runPostSignAutomation) runs synchronously inside
    // signQuotePublicly before it returns, so by the time the customer's
    // own submit resolved above, applySignedQuoteToJob has already run.
    const { rows: jobRows } = await db.query(
      `select address, latitude, longitude from jobs where id = $1`,
      [job.jobId],
    );
    expect(jobRows).toHaveLength(1);
    expect(jobRows[0].address).toBe(signingAddress);
    expect(jobRows[0].latitude).toBe(latitude.toFixed(7));
    expect(jobRows[0].longitude).toBe(longitude.toFixed(7));

    // The historical signature record itself is untouched — same address/
    // coordinates, never rewritten by the propagation.
    const { rows: sigRows } = await db.query(
      `select qs.customer_address_at_signing, qs.latitude, qs.longitude
       from quote_signatures qs
       join quote_versions qv on qv.id = qs.quote_version_id
       join quotes q on q.id = qv.quote_id
       where q.job_id = $1`,
      [job.jobId],
    );
    expect(sigRows).toHaveLength(1);
    expect(sigRows[0].customer_address_at_signing).toBe(signingAddress);
    expect(sigRows[0].latitude).toBe(latitude.toFixed(7));
    expect(sigRows[0].longitude).toBe(longitude.toFixed(7));
  });

  test("the factory public page serves a real measurement attachment through a factory-token-scoped route, and refuses an attachment belonging to a different job's token", async ({
    page,
    loginAs,
    db,
    request,
  }) => {
    await loginAs(page, "issam");
    const phoneA = uniquePhone();
    const jobAId = await submitFieldMeasurementWithAttachment(page, {
      phone: phoneA,
      customerName: uniqueLabel("عميل مرفقات أ"),
      fileName: "measurement-a.png",
    });

    // A second, completely unrelated job + attachment — used only to prove
    // its attachment id is refused when requested through job A's token.
    const phoneB = uniquePhone();
    const jobBId = await submitFieldMeasurementWithAttachment(page, {
      phone: phoneB,
      customerName: uniqueLabel("عميل مرفقات ب"),
      fileName: "measurement-b.png",
    });
    const { rows: otherAttachmentRows } = await db.query(
      `select ma.id
       from measurement_attachments ma
       join measurements m on m.id = ma.measurement_id
       where m.job_id = $1`,
      [jobBId],
    );
    expect(otherAttachmentRows).toHaveLength(1);
    const otherJobAttachmentId: string = otherAttachmentRows[0].id;

    await loginAs(page, "mohammad");

    // Job B only exists to donate a real, cross-job attachment id above —
    // cancel it now rather than leaving it parked at field_submission_
    // pending indefinitely, which would otherwise inflate the shared dev
    // DB's "قياسات ميدانية بانتظار المراجعة" count for every other test in
    // this suite run (see new-measurement.spec.ts's own dashboard-preview
    // test and its comment on PREVIEW_LIMIT truncation).
    await page.goto(`/jobs/${jobBId}`, { waitUntil: "networkidle" });
    await page.click('button:has-text("إلغاء المهمة")');
    const cancelDialog = page.locator('[role="dialog"]');
    await cancelDialog.locator("#reason").fill("مهمة اختبار فقط — لا حاجة لها");
    await cancelDialog.locator('button:has-text("تأكيد إلغاء المهمة")').click();
    await page.waitForSelector('[role="dialog"]', { state: "hidden", timeout: 10_000 });
    await page.waitForTimeout(400);

    await page.goto(`/jobs/${jobAId}`, { waitUntil: "networkidle" });
    await page.click('button:has-text("إضافة بند")');
    const itemDialog = page.locator('[role="dialog"]');
    await itemDialog.locator("#description").fill("بند إنتاج — زجاج شرفة");
    await itemDialog.locator("#quantity").fill("2");
    await itemDialog.locator('button:has-text("إضافة البند")').click();
    await page.waitForTimeout(500);

    const factoryLink = await sendToFactory(page, "راجع القياس والمرفقات أدناه.");
    expect(factoryLink).toMatch(/\/public\/pr\//);
    const token = factoryLink.split("/public/pr/")[1];

    const factoryCtx = await page.context().browser()!.newContext({ locale: "ar" });
    const factoryPage = await factoryCtx.newPage();
    await factoryPage.goto(factoryLink, { waitUntil: "networkidle" });
    const text = await factoryPage.innerText("body");
    expect(text).toContain("بند إنتاج — زجاج شرفة");
    expect(text).toContain("measurement-a.png");

    const attachmentLink = factoryPage.locator('a:has-text("measurement-a.png")');
    const href = await attachmentLink.getAttribute("href");
    expect(href).toMatch(new RegExp(`^/api/public/pr/${token}/attachments/`));

    const realFileResponse = await request.get(`${new URL(page.url()).origin}${href}`);
    expect(realFileResponse.status()).toBe(200);
    expect(realFileResponse.headers()["content-type"]).toBe("image/png");
    const body = await realFileResponse.body();
    expect(body.length).toBeGreaterThan(0);

    // The child-entity check: job B's attachment id does not belong to job
    // A's production request, even though it is a real, existing row.
    const crossJobResponse = await request.get(
      `${new URL(page.url()).origin}/api/public/pr/${token}/attachments/${otherJobAttachmentId}`,
    );
    expect(crossJobResponse.status()).toBe(404);

    await factoryCtx.close();
  });

  test("approving a factory price with no installer assigned notifies ASSIGN_INSTALLER holders (Needs Installer Assignment); an already-assigned installer is notified directly instead", async ({
    page,
    loginAs,
    db,
  }) => {
    const mohammadId = await demoUserId(db, "mohammad");
    const baselId = await demoUserId(db, "basel");

    await loginAs(page, "mohammad");

    // Job A: nobody ever assigned — the "needs installer" branch.
    const jobA = await createLeadJob(page, {
      customerName: uniqueLabel("عميل بلا فني"),
      customerPhone: uniquePhone(),
      title: "اختبار — بلا فني معيّن",
    });
    const linkA = await sendToFactory(page, "طلب اختبار أ");
    await submitAndApproveFactoryPrice(page, linkA, jobA.href);

    const { rows: needsInstallRows } = await db.query(
      `select 1
       from jobs j
       join job_statuses js on js.id = j.status_id
       where j.id = $1
         and js.key in ('ready_from_factory', 'installation_scheduled', 'installation_in_progress')
         and not exists (select 1 from job_assignments ja where ja.job_id = j.id)`,
      [jobA.jobId],
    );
    expect(needsInstallRows).toHaveLength(1); // job A genuinely matches the "needs installer" condition

    const { rows: needsInstallNotif } = await db.query(
      `select 1 from notifications
       where type = 'job_needs_installer_assignment' and user_id = $1 and related_entity_id = $2`,
      [mohammadId, jobA.jobId],
    );
    expect(needsInstallNotif.length).toBeGreaterThanOrEqual(1);

    await page.goto("/dashboard", { waitUntil: "networkidle" });
    await expect(page.locator("text=بحاجة إلى تعيين فني تركيب")).toBeVisible();

    // Job B: Basel is assigned BEFORE the job ever reaches the factory —
    // the "already assigned, dispatch directly" branch.
    const jobB = await createLeadJob(page, {
      customerName: uniqueLabel("عميل مع فني"),
      customerPhone: uniquePhone(),
      title: "اختبار — فني معيّن مسبقاً",
    });
    await page.click('button:has-text("تعيين فني")');
    const assignDialog = page.locator('[role="dialog"]');
    await assignDialog.locator("#userId").click();
    await page.locator('[role="option"]:has-text("باسل")').click();
    await assignDialog.locator('button:has-text("تعيين"):not(:has-text("فني"))').click();
    await page.waitForTimeout(500);

    const linkB = await sendToFactory(page, "طلب اختبار ب");
    await submitAndApproveFactoryPrice(page, linkB, jobB.href);

    const { rows: stillNeedsInstallRows } = await db.query(
      `select 1
       from jobs j
       join job_statuses js on js.id = j.status_id
       where j.id = $1
         and js.key in ('ready_from_factory', 'installation_scheduled', 'installation_in_progress')
         and not exists (select 1 from job_assignments ja where ja.job_id = j.id)`,
      [jobB.jobId],
    );
    expect(stillNeedsInstallRows).toHaveLength(0); // job B does NOT match — Basel is assigned

    const { rows: readyNotif } = await db.query(
      `select 1 from notifications
       where type = 'job_ready_for_installation' and user_id = $1 and related_entity_id = $2`,
      [baselId, jobB.jobId],
    );
    expect(readyNotif.length).toBeGreaterThanOrEqual(1);

    const { rows: noNeedsInstallForB } = await db.query(
      `select 1 from notifications
       where type = 'job_needs_installer_assignment' and related_entity_id = $1`,
      [jobB.jobId],
    );
    expect(noNeedsInstallForB).toHaveLength(0);
  });
});
