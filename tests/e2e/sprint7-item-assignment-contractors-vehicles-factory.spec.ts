import {
  test,
  expect,
  createLeadJob,
  uniquePhone,
  uniqueLabel,
  demoUserId,
} from "./fixtures";
import type { Page } from "@playwright/test";

/**
 * Sprint 7 regression coverage: "do not count schema support as feature
 * completion." Item-level job assignment, contractor CRUD, technician
 * overtime/adjustment workflows, production request numbering, vehicle
 * maintenance costs, and factory public-link expiration/revocation/
 * regeneration — six previously schema-only-or-entirely-missing features.
 */

declare global {
  interface Window {
    __origFetch?: typeof fetch;
    __capturedRequests?: Array<Parameters<typeof fetch>>;
  }
}

/** Same capture-then-tampered-replay technique as job-scoped-
 * authorization.spec.ts (duplicated locally, matching this suite's
 * per-file convention for wire-protocol tests rather than a shared
 * cross-file helper) — proves a fix holds at the Server Action wire
 * level, not merely that the UI never offers the tampered path. */
async function patchFetchCapture(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__capturedRequests = [];
    if (!window.__origFetch) window.__origFetch = window.fetch;
    const origFetch = window.__origFetch;
    window.fetch = function (...args: Parameters<typeof fetch>) {
      window.__capturedRequests!.push(args);
      return origFetch.apply(window, args);
    };
  });
}

async function readLastCapturedFormEntries(page: Page): Promise<{
  url: string;
  headers: Record<string, string>;
  entries: [string, string][];
}> {
  return page.evaluate(() => {
    const requests = window.__capturedRequests!;
    const [url, opts] = requests[requests.length - 1];
    const headers = Object.fromEntries(new Headers(opts?.headers).entries());
    const body = opts?.body as FormData;
    return {
      url: String(url),
      headers,
      entries: Array.from(body.entries()).map(([k, v]) => [k, String(v)]) as [string, string][],
    };
  });
}

test.describe("Sprint 7 — item-level assignment, contractors, technician adjustments", () => {
  test("assigning an installer to a specific job item persists jobItemId, and the server rejects an item id tampered to belong to a different job", async ({
    page,
    loginAs,
    db,
  }) => {
    const baselId = await demoUserId(db, "basel");
    await loginAs(page, "mohammad");

    const job = await createLeadJob(page, {
      customerName: uniqueLabel("عميل تعيين بند"),
      customerPhone: uniquePhone(),
      title: "اختبار تعيين على بند محدد",
    });
    await page.click('button:has-text("إضافة بند")');
    const itemDialog = page.locator('[role="dialog"]');
    await itemDialog.locator("#description").fill("بند اختبار الزجاج");
    await itemDialog.locator("#quantity").fill("1");
    await itemDialog.locator('button:has-text("إضافة البند")').click();
    await page.waitForTimeout(500);

    const { rows: itemRows } = await db.query(
      `select id from job_items where job_id = $1`,
      [job.jobId],
    );
    expect(itemRows).toHaveLength(1);
    const itemId: string = itemRows[0].id;

    // A second, unrelated job + item — the tamper target below.
    const otherJob = await createLeadJob(page, {
      customerName: uniqueLabel("عميل بند آخر"),
      customerPhone: uniquePhone(),
      title: "اختبار — مهمة أخرى غير ذات صلة",
    });
    await page.click('button:has-text("إضافة بند")');
    const otherItemDialog = page.locator('[role="dialog"]');
    await otherItemDialog.locator("#description").fill("بند مهمة أخرى");
    await otherItemDialog.locator("#quantity").fill("1");
    await otherItemDialog.locator('button:has-text("إضافة البند")').click();
    await page.waitForTimeout(500);
    const { rows: otherItemRows } = await db.query(
      `select id from job_items where job_id = $1`,
      [otherJob.jobId],
    );
    const otherItemId: string = otherItemRows[0].id;

    // The legitimate call: assign Basel to job A's own item.
    await page.goto(job.href, { waitUntil: "networkidle" });
    await patchFetchCapture(page);
    await page.click('button:has-text("تعيين فني")');
    const assignDialog = page.locator('[role="dialog"]');
    await assignDialog.locator("#userId").click();
    await page.locator('[role="option"]:has-text("باسل")').click();
    await assignDialog.locator("#jobItemId").click();
    await page.locator('[role="option"]:has-text("بند اختبار الزجاج")').click();
    await assignDialog.locator('button:has-text("تعيين"):not(:has-text("فني"))').click();
    await page.waitForTimeout(500);

    const { rows: assignmentRows } = await db.query(
      `select id, job_item_id, user_id from job_assignments where job_id = $1`,
      [job.jobId],
    );
    expect(assignmentRows).toHaveLength(1);
    expect(assignmentRows[0].job_item_id).toBe(itemId);
    expect(assignmentRows[0].user_id).toBe(baselId);

    const text = await page.innerText("main");
    expect(text).toContain("بند: بند اختبار الزجاج");

    // Tamper: replay the exact same captured request, but with the plain
    // (non-bound) jobItemId form field swapped to job B's real item —
    // while the bound jobId (inside the "0" field's JSON, untouched)
    // stays job A's own, which Mohammad is legitimately allowed to act
    // on. This is exactly the child-entity-mismatch shape: a real child
    // row that belongs to a DIFFERENT job. jobItemId is a plain hidden
    // <input>, not a bound leading argument, so it's its own FormData
    // entry (whichever key React gave it) rather than nested inside "0"
    // alongside jobId — find it by VALUE rather than assume the key name.
    const captured = await readLastCapturedFormEntries(page);
    const tamperedEntries = captured.entries.map(([k, v]): [string, string] =>
      v === itemId ? [k, otherItemId] : [k, v],
    );
    expect(tamperedEntries.some(([, v]) => v === otherItemId)).toBe(true);
    expect(captured.entries.some(([, v]) => v === itemId)).toBe(true); // confirms itemId really was captured somewhere

    await page.evaluate(
      async ({ url, headers, entries }) => {
        const fd = new FormData();
        for (const [k, v] of entries) fd.append(k, v);
        await window.__origFetch!(url, {
          method: "POST",
          headers: { "next-action": headers["next-action"], accept: headers["accept"] },
          body: fd,
        });
      },
      { url: captured.url, headers: captured.headers, entries: tamperedEntries },
    );
    await page.waitForTimeout(500);

    // Still exactly the ONE legitimate assignment from before — the
    // tampered replay created no second row.
    const { rows: assignmentsAfter } = await db.query(
      `select id from job_assignments where job_id = $1`,
      [job.jobId],
    );
    expect(assignmentsAfter).toHaveLength(1);
    const { rows: otherJobAssignments } = await db.query(
      `select id from job_assignments where job_id = $1`,
      [otherJob.jobId],
    );
    expect(otherJobAssignments).toHaveLength(0);
  });

  test("a contractor can be created, edited, deactivated, and reactivated — the roster page, not just seed.ts, is the only write path before this sprint's actions existed", async ({
    page,
    loginAs,
    db,
  }) => {
    await loginAs(page, "mohammad");
    await page.goto("/contractors", { waitUntil: "networkidle" });

    const contractorName = uniqueLabel("مقاول اختبار");
    await page.click('button:has-text("مقاول جديد")');
    const createDialog = page.locator('[role="dialog"]');
    await createDialog.locator("#contractor-name").fill(contractorName);
    await createDialog.locator("#contractor-phone").fill("0521234567");
    await createDialog.locator("#contractor-service-type").fill("ألمنيوم");
    await createDialog.locator('button:has-text("إضافة المقاول")').click();
    await page.waitForSelector("text=تم إضافة المقاول", { timeout: 10_000 });

    const { rows: created } = await db.query(
      `select id, phone, service_type, is_active from external_contractors where name = $1`,
      [contractorName],
    );
    expect(created).toHaveLength(1);
    expect(created[0].phone).toBe("0521234567");
    expect(created[0].service_type).toBe("ألمنيوم");
    expect(created[0].is_active).toBe(true);
    const contractorId: string = created[0].id;

    // Edit.
    const row = page.locator("tr", { hasText: contractorName });
    await row.locator('button:has-text("تعديل")').click();
    const editDialog = page.locator('[role="dialog"]');
    await editDialog.locator("#contractor-service-type").fill("زجاج");
    await editDialog.locator('button:has-text("حفظ التعديلات")').click();
    await page.waitForSelector("text=تم تحديث بيانات المقاول", { timeout: 10_000 });

    const { rows: afterEdit } = await db.query(
      `select service_type from external_contractors where id = $1`,
      [contractorId],
    );
    expect(afterEdit[0].service_type).toBe("زجاج");

    // Deactivate, then reactivate.
    await row.locator('button:has-text("إلغاء التفعيل")').click();
    await page.waitForTimeout(500);
    const { rows: afterDeactivate } = await db.query(
      `select is_active from external_contractors where id = $1`,
      [contractorId],
    );
    expect(afterDeactivate[0].is_active).toBe(false);

    await row.locator('button:has-text("تفعيل")').click();
    await page.waitForTimeout(500);
    const { rows: afterReactivate } = await db.query(
      `select is_active from external_contractors where id = $1`,
      [contractorId],
    );
    expect(afterReactivate[0].is_active).toBe(true);
  });

  test("overtime and a manual ledger adjustment both post correctly-signed technician_ledger_entries rows via previously-nonexistent (or zero-writer) actions", async ({
    page,
    loginAs,
    db,
  }) => {
    const baselId = await demoUserId(db, "basel");
    await loginAs(page, "mohammad");
    await page.goto(`/finance/technicians/${baselId}`, { waitUntil: "networkidle" });

    await page.click('button:has-text("عمل إضافي")');
    const overtimeDialog = page.locator('[role="dialog"]');
    await overtimeDialog.locator("#overtime-hours").fill("3");
    await overtimeDialog.locator("#overtime-rate").fill("40");
    await overtimeDialog.locator('button:has-text("تسجيل")').click();
    await page.waitForSelector("text=تم تسجيل العمل الإضافي", { timeout: 10_000 });

    const { rows: overtimeRows } = await db.query(
      `select amount, quantity, rate_used, approval_status from technician_ledger_entries
       where user_id = $1 and entry_type = 'overtime' order by created_at desc limit 1`,
      [baselId],
    );
    expect(overtimeRows).toHaveLength(1);
    expect(overtimeRows[0].amount).toBe("120.00"); // 3 * 40
    expect(overtimeRows[0].quantity).toBe("3.00");
    expect(overtimeRows[0].rate_used).toBe("40.00");
    expect(overtimeRows[0].approval_status).toBe("approved");

    await page.click('button:has-text("تسوية حساب")');
    const adjustmentDialog = page.locator('[role="dialog"]');
    await adjustmentDialog.locator("#adjustment-direction").click();
    await page.locator('[role="option"]:has-text("خصم من الحساب")').click();
    await adjustmentDialog.locator("#adjustment-amount").fill("55");
    await adjustmentDialog.locator("#adjustment-description").fill("اختبار تسوية خصم");
    await adjustmentDialog.locator('button:has-text("تسجيل")').click();
    await page.waitForSelector("text=تم تسجيل التسوية", { timeout: 10_000 });

    const { rows: adjustmentRows } = await db.query(
      `select amount, entry_type, description from technician_ledger_entries
       where user_id = $1 and entry_type = 'other_adjustment' and description = $2`,
      [baselId, "اختبار تسوية خصم"],
    );
    expect(adjustmentRows).toHaveLength(1);
    expect(adjustmentRows[0].amount).toBe("-55.00"); // debit, correctly negative
  });
});

test.describe("Sprint 7 — production numbering, vehicle maintenance costs, factory link lifecycle", () => {
  test("a production request is issued with a real PR-YYYY-NNNN number, and a vehicle maintenance cost is reflected in the running-cost total", async ({
    page,
    loginAs,
    db,
  }) => {
    await loginAs(page, "mohammad");
    const job = await createLeadJob(page, {
      customerName: uniqueLabel("عميل ترقيم الإنتاج"),
      customerPhone: uniquePhone(),
      title: "اختبار ترقيم طلب الإنتاج",
    });
    await page.click('button:has-text("إرسال إلى المصنع")');
    const sendDialog = page.locator('[role="dialog"]');
    await sendDialog.locator("#details").fill("اختبار ترقيم طلب الإنتاج");
    await sendDialog.locator('button:has-text("إرسال إلى المصنع")').click();
    await page.waitForSelector("text=تم إنشاء طلب الإنتاج", { timeout: 10_000 });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    const { rows: requestRows } = await db.query(
      `select request_number from production_requests where job_id = $1`,
      [job.jobId],
    );
    expect(requestRows).toHaveLength(1);
    expect(requestRows[0].request_number).toMatch(/^PR-\d{4}-\d{4}$/);

    await page.reload({ waitUntil: "networkidle" });
    const jobPageText = await page.innerText("main");
    expect(jobPageText).toContain(requestRows[0].request_number);

    // Vehicle maintenance cost — a completely separate feature area,
    // covered in the same test to keep this file's test count reasonable.
    // Mohammad holds neither MANAGE_VEHICLES nor ADD_FUEL in the seed, so
    // /vehicles is Forbidden to him — switch to Amr (super admin) for
    // this part.
    await loginAs(page, "amr");
    await page.goto("/vehicles", { waitUntil: "networkidle" });
    await page.click('a:has-text("فان ترانزيت")');
    await page.waitForURL(/\/vehicles\/[0-9a-fA-F-]{36}$/);
    const vehicleUrl = page.url();
    const vehicleId = new URL(vehicleUrl).pathname.split("/").pop()!;

    const { rows: beforeCost } = await db.query(
      `select coalesce(sum(amount), 0)::text as total from vehicle_maintenance_costs where vehicle_id = $1`,
      [vehicleId],
    );

    await page.click('button:has-text("تكلفة تشغيل")');
    const costDialog = page.locator('[role="dialog"]');
    await costDialog.locator("#maintenance-amount").fill("350");
    await costDialog
      .locator("#maintenance-description")
      .fill(uniqueLabel("اختبار صيانة — تبديل زيت"));
    await costDialog.locator('button:has-text("تسجيل التكلفة")').click();
    await page.waitForSelector("text=تم تسجيل التكلفة", { timeout: 10_000 });

    const { rows: afterCost } = await db.query(
      `select coalesce(sum(amount), 0)::text as total from vehicle_maintenance_costs where vehicle_id = $1`,
      [vehicleId],
    );
    expect(Number(afterCost[0].total) - Number(beforeCost[0].total)).toBeCloseTo(350, 2);

    await page.reload({ waitUntil: "networkidle" });
    const vehicleText = await page.innerText("main");
    expect(vehicleText).toContain("تبديل زيت");
  });

  test("factory link expiration/revocation are enforced server-side, and regeneration issues a genuinely working replacement", async ({
    page,
    loginAs,
    db,
  }) => {
    await loginAs(page, "mohammad");
    const job = await createLeadJob(page, {
      customerName: uniqueLabel("عميل صلاحية رابط المصنع"),
      customerPhone: uniquePhone(),
      title: "اختبار انتهاء وإلغاء رابط المصنع",
    });
    await page.click('button:has-text("إرسال إلى المصنع")');
    const sendDialog = page.locator('[role="dialog"]');
    await sendDialog.locator("#details").fill("اختبار صلاحية الرابط");
    await sendDialog.locator('button:has-text("إرسال إلى المصنع")').click();
    await page.waitForSelector("text=تم إنشاء طلب الإنتاج", { timeout: 10_000 });
    const originalLink = await page.locator('[role="dialog"] input[readonly]').inputValue();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    const { rows: prRows } = await db.query(
      `select fpl.id as link_id, pr.id as production_request_id
       from factory_public_links fpl
       join production_requests pr on pr.id = fpl.production_request_id
       where pr.job_id = $1`,
      [job.jobId],
    );
    expect(prRows).toHaveLength(1);
    const productionRequestId: string = prRows[0].production_request_id;

    // A freshly-created link must default to a real, future expiresAt —
    // not null forever, the exact gap this sprint closed.
    const { rows: freshLinkRows } = await db.query(
      `select expires_at from factory_public_links where id = $1`,
      [prRows[0].link_id],
    );
    expect(freshLinkRows[0].expires_at).not.toBeNull();
    expect(new Date(freshLinkRows[0].expires_at).getTime()).toBeGreaterThan(Date.now());

    // Backdate it to already-expired, then confirm the public submit path
    // refuses it server-side (not just a UI affordance).
    await db.query(
      `update factory_public_links set expires_at = now() - interval '1 day' where id = $1`,
      [prRows[0].link_id],
    );
    await page.reload({ waitUntil: "networkidle" });

    const expiredPageText = await page
      .context()
      .newPage()
      .then(async (p) => {
        await p.goto(originalLink, { waitUntil: "networkidle" });
        const t = await p.innerText("body");
        await p.close();
        return t;
      });
    expect(expiredPageText).toContain("انتهت صلاحية هذا الرابط");
    // No submit form is rendered at all once expired (confirmed above by
    // the page's own text) — the DB is the authoritative proof that
    // nothing was ever accepted through it.
    const { rows: submissionsAfterExpiredAttempt } = await db.query(
      `select id from factory_submissions where production_request_id = $1`,
      [productionRequestId],
    );
    expect(submissionsAfterExpiredAttempt).toHaveLength(0);

    // Regenerate — old link (still expired) stays unusable, new one works.
    await page.click('button:has-text("إصدار رابط جديد")');
    await page.waitForSelector("text=تم إصدار رابط جديد", { timeout: 10_000 });
    const newLink = await page
      .locator('[role="dialog"]')
      .locator("input[readonly]")
      .inputValue();
    expect(newLink).not.toBe(originalLink);
    await page.locator('[role="dialog"] button:has-text("تم")').click();

    const factoryCtx = await page.context().browser()!.newContext({ locale: "ar" });
    const factoryPage = await factoryCtx.newPage();
    await factoryPage.goto(newLink, { waitUntil: "networkidle" });
    await factoryPage.fill("#submittedPrice", "1234");
    await factoryPage.locator('button:has-text("إرسال السعر")').click();
    await factoryPage.waitForSelector("text=تم استلام عرضكم", { timeout: 10_000 });
    await factoryCtx.close();

    const { rows: submissionsAfterRegenerate } = await db.query(
      `select submitted_price from factory_submissions where production_request_id = $1`,
      [productionRequestId],
    );
    expect(submissionsAfterRegenerate).toHaveLength(1);
    expect(submissionsAfterRegenerate[0].submitted_price).toBe("1234.00");

    // Revoke the (now-active) regenerated link explicitly and confirm the
    // public page reflects it.
    const { rows: activeLinkRows } = await db.query(
      `select id from factory_public_links
       where production_request_id = $1 and revoked_at is null`,
      [productionRequestId],
    );
    expect(activeLinkRows).toHaveLength(1);
    await page.reload({ waitUntil: "networkidle" });
    await page.click('button:has-text("إلغاء الرابط")');
    await page.locator('[role="alertdialog"]').locator('button:has-text("تأكيد الإلغاء")').click();
    await page.waitForSelector("text=تم إلغاء الرابط", { timeout: 10_000 });

    const revokedPageText = await page
      .context()
      .newPage()
      .then(async (p) => {
        await p.goto(newLink, { waitUntil: "networkidle" });
        const t = await p.innerText("body");
        await p.close();
        return t;
      });
    expect(revokedPageText).toContain("تم إلغاء هذا الرابط");
  });
});
