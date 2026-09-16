import {
  test,
  expect,
  createLeadJob,
  uniquePhone,
  uniqueLabel,
  demoUserId,
  DEMO_USERS,
} from "./fixtures";
import type { Page } from "@playwright/test";

declare global {
  interface Window {
    __origFetch?: typeof fetch;
    __capturedRequests?: Array<Parameters<typeof fetch>>;
  }
}

/** Same wire-capture/tamper-replay technique as job-scoped-authorization.spec.ts
 * — needed here because the UI itself already hides "إلغاء المهمة" once a
 * job is terminal (jobs/[id]/page.tsx: `canCancel = ... && !job.isTerminal`),
 * so the server-side guard this test proves can only be exercised by
 * calling the Server Action directly, bypassing the page that would never
 * render the button to a legitimate user in this state. */
async function patchFetchCapture(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__capturedRequests = [];
    if (!window.__origFetch) {
      window.__origFetch = window.fetch;
    }
    const origFetch = window.__origFetch;
    window.fetch = function (...args: Parameters<typeof fetch>) {
      window.__capturedRequests!.push(args);
      return origFetch.apply(window, args);
    };
  });
}

async function readLastCapturedFormData(
  page: Page,
): Promise<{ url: string; headers: Record<string, string>; entries: [string, string][] }> {
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

/**
 * Regression coverage for the findings an adversarial multi-agent audit
 * surfaced against the "V1 complete" declaration — each independently
 * re-verified against the real code before being fixed, not taken on the
 * audit's word alone. See docs/requirements-matrix.md's Sprint 10 entry
 * (second half, added after the initial release-gate pass) for the full
 * writeup of each.
 */

test.describe("Sprint 10 — adversarial audit fixes", () => {
  test("an expired (not merely revoked) factory link's attachment route refuses, matching every other factoryPublicLinks consumer", async ({
    page,
    loginAs,
    db,
    request,
  }) => {
    await loginAs(page, "mohammad");
    const job = await createLeadJob(page, {
      customerName: uniqueLabel("عميل رابط منتهي"),
      customerPhone: uniquePhone(),
      title: "اختبار انتهاء رابط المصنع",
    });

    const requestNumber = uniqueLabel("PR-TEST").replace(/[^\w-]/g, "").slice(0, 30);
    const { rows: prRows } = await db.query(
      `insert into production_requests (job_id, request_number, status, requested_by_user_id)
       values ($1, $2, 'pending', $3) returning id`,
      [job.jobId, requestNumber, await demoUserId(db, "mohammad")],
    );
    const productionRequestId: string = prRows[0].id;

    const token = uniqueLabel("tok").replace(/[^\w-]/g, "");
    await db.query(
      `insert into factory_public_links (production_request_id, token, expires_at)
       values ($1, $2, now() - interval '1 day')`,
      [productionRequestId, token],
    );

    const res = await request.get(
      `/api/public/pr/${token}/attachments/00000000-0000-0000-0000-000000000000`,
    );
    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("انتهت صلاحية هذا الرابط.");
  });

  test("cancelJob refuses on an already-closed job, via a direct request since the UI itself never renders the button in this state", async ({
    page,
    loginAs,
    db,
  }) => {
    await loginAs(page, "amr");
    const job = await createLeadJob(page, {
      customerName: uniqueLabel("عميل إلغاء مهمة مغلقة"),
      customerPhone: uniquePhone(),
      title: "اختبار إلغاء مهمة مغلقة بالفعل",
    });
    await db.query(`update jobs set sale_price_total = '500.00' where id = $1`, [job.jobId]);

    await page.goto(job.href, { waitUntil: "networkidle" });
    await page.click('button:has-text("إضافة دفعة")');
    const paymentDialog = page.locator('[role="dialog"]');
    await paymentDialog.locator("#amount").fill("500");
    await paymentDialog.locator('button:has-text("إضافة الدفعة")').click();
    await page.waitForSelector("text=تم تسجيل الدفعة", { timeout: 10_000 });
    await page.waitForTimeout(500);

    await page.goto(job.href, { waitUntil: "networkidle" });
    await page.click('button:has-text("إغلاق المهمة")');
    await page.locator('[role="alertdialog"]').locator('button:has-text("تأكيد الإغلاق")').click();
    await page.waitForTimeout(700);

    const { rows: closedRows } = await db.query(
      `select js.key as status, j.updated_at from jobs j
       join job_statuses js on js.id = j.status_id where j.id = $1`,
      [job.jobId],
    );
    expect(closedRows[0].status).toBe("completed");
    const updatedAtBefore = closedRows[0].updated_at;

    // The UI already hides "إلغاء المهمة" for a terminal job (page.tsx:
    // canCancel = ... && !job.isTerminal), so this can only be exercised
    // by calling cancelJob directly. A second, ordinary open job supplies
    // the one legitimate call needed to learn the current build's
    // next-action hash and exact FormData shape — its own successful
    // cancellation below also proves the fix doesn't break the real path.
    const openJob = await createLeadJob(page, {
      customerName: uniqueLabel("عميل مهمة مفتوحة للمقارنة"),
      customerPhone: uniquePhone(),
      title: "اختبار إلغاء مهمة مفتوحة (المسار الشرعي)",
    });
    await page.goto(openJob.href, { waitUntil: "networkidle" });
    await patchFetchCapture(page);
    await page.click('button:has-text("إلغاء المهمة")');
    const cancelDialog = page.locator('[role="dialog"]');
    await cancelDialog.locator("#reason").fill("سبب إلغاء شرعي لمهمة مفتوحة");
    await cancelDialog.locator('button:has-text("تأكيد إلغاء المهمة")').click();
    await page.waitForTimeout(700);

    const captured = await readLastCapturedFormData(page);
    const tamperedEntries = captured.entries.map(([k, v]): [string, string] =>
      k === "0" ? [k, v.replace(openJob.jobId, job.jobId)] : [k, v],
    );
    expect(tamperedEntries.some(([k, v]) => k === "0" && v.includes(job.jobId))).toBe(true);

    const replayStatus = await page.evaluate(
      async ({ url, headers, entries }) => {
        const fd = new FormData();
        for (const [k, v] of entries) fd.append(k, v);
        const res = await window.__origFetch!(url, {
          method: "POST",
          headers: { "next-action": headers["next-action"], accept: headers["accept"] },
          body: fd,
        });
        return res.status;
      },
      { url: captured.url, headers: captured.headers, entries: tamperedEntries },
    );
    expect(replayStatus).toBe(200); // caught error, still 200 — see the suite's own convention

    const { rows: afterRows } = await db.query(
      `select js.key as status, j.updated_at from jobs j
       join job_statuses js on js.id = j.status_id where j.id = $1`,
      [job.jobId],
    );
    expect(afterRows[0].status).toBe("completed");
    // The refused cancel must not have written anything at all.
    expect(new Date(afterRows[0].updated_at).getTime()).toBe(new Date(updatedAtBefore).getTime());

    // And the legitimate call, on openJob, DID succeed — proving the fix
    // didn't break normal cancellation of a real, still-open job.
    const { rows: openJobRows } = await db.query(
      `select js.key as status from jobs j
       join job_statuses js on js.id = j.status_id where j.id = $1`,
      [openJob.jobId],
    );
    expect(openJobRows[0].status).toBe("cancelled");
  });

  test("approveFactorySubmission refuses on an already-closed job and books no new job_costs row", async ({
    page,
    loginAs,
    db,
  }) => {
    await loginAs(page, "mohammad");
    const job = await createLeadJob(page, {
      customerName: uniqueLabel("عميل اعتماد على مهمة مغلقة"),
      customerPhone: uniquePhone(),
      title: "اختبار اعتماد سعر مصنع على مهمة مغلقة",
    });
    await db.query(`update jobs set sale_price_total = '300.00' where id = $1`, [job.jobId]);

    const requestNumber = uniqueLabel("PR-TEST").replace(/[^\w-]/g, "").slice(0, 30);
    const { rows: prRows } = await db.query(
      `insert into production_requests (job_id, request_number, status, requested_by_user_id)
       values ($1, $2, 'submitted', $3) returning id`,
      [job.jobId, requestNumber, await demoUserId(db, "mohammad")],
    );
    const productionRequestId: string = prRows[0].id;
    const { rows: subRows } = await db.query(
      `insert into factory_submissions (production_request_id, submitted_price, submitted_at, approval_status)
       values ($1, '150.00', now(), 'pending') returning id`,
      [productionRequestId],
    );
    const submissionId: string = subRows[0].id;

    const { rows: costsBefore } = await db.query(
      `select count(*)::int as c from job_costs where job_id = $1`,
      [job.jobId],
    );
    expect(costsBefore[0].c).toBe(0);

    // Auto-approved payment (super admin) so the job can actually close.
    await loginAs(page, "amr");
    await page.goto(job.href, { waitUntil: "networkidle" });
    await page.click('button:has-text("إضافة دفعة")');
    const paymentDialog = page.locator('[role="dialog"]');
    await paymentDialog.locator("#amount").fill("300");
    await paymentDialog.locator('button:has-text("إضافة الدفعة")').click();
    await page.waitForSelector("text=تم تسجيل الدفعة", { timeout: 10_000 });
    await page.waitForTimeout(500);

    await page.goto(job.href, { waitUntil: "networkidle" });
    await page.click('button:has-text("إغلاق المهمة")');
    await page.locator('[role="alertdialog"]').locator('button:has-text("تأكيد الإغلاق")').click();
    await page.waitForTimeout(700);
    const { rows: statusRows } = await db.query(
      `select js.key as status from jobs j join job_statuses js on js.id = j.status_id where j.id = $1`,
      [job.jobId],
    );
    expect(statusRows[0].status).toBe("completed");

    // Now try to approve the still-pending factory submission on this
    // already-closed job.
    await loginAs(page, "mohammad"); // holds APPROVE_FACTORY_PRICE
    await page.goto(job.href, { waitUntil: "networkidle" });
    await page.click('button[aria-label="اعتماد سعر المصنع"]');
    await page.locator('[role="alertdialog"]').locator('button:has-text("اعتماد")').click();
    await page.waitForTimeout(700);

    const bodyText = await page.innerText("body");
    expect(bodyText).toContain("لا يمكن اعتماد سعر مصنع على مهمة مغلقة");

    const { rows: costsAfter } = await db.query(
      `select count(*)::int as c from job_costs where job_id = $1 and category = 'factory_glass'`,
      [job.jobId],
    );
    expect(costsAfter[0].c).toBe(0);

    const { rows: submissionAfter } = await db.query(
      `select approval_status from factory_submissions where id = $1`,
      [submissionId],
    );
    expect(submissionAfter[0].approval_status).toBe("pending");
  });

  test("a COLLECT_PAYMENT-only viewer (no VIEW_SALE_PRICE) can see the remaining balance to collect, but cannot reconstruct the exact sale price from the Payments card", async ({
    page,
    loginAs,
    db,
  }) => {
    await loginAs(page, "mohammad");
    const job = await createLeadJob(page, {
      customerName: uniqueLabel("عميل إعادة بناء السعر"),
      customerPhone: uniquePhone(),
      title: "اختبار عدم كشف السعر عبر المدفوعات",
    });
    await db.query(`update jobs set sale_price_total = '6500.00' where id = $1`, [job.jobId]);

    await page.click('button:has-text("تعيين فني")');
    const assignDialog = page.locator('[role="dialog"]');
    await assignDialog.locator("#userId").click();
    await page.locator(`[role="option"]:has-text("${DEMO_USERS.basel.name}")`).click();
    await assignDialog.locator('button:has-text("تعيين"):not(:has-text("فني"))').click();
    await page.waitForTimeout(500);

    await loginAs(page, "amr");
    await page.goto(job.href, { waitUntil: "networkidle" });
    await page.click('button:has-text("إضافة دفعة")');
    const paymentDialog = page.locator('[role="dialog"]');
    await paymentDialog.locator("#amount").fill("2000");
    await paymentDialog.locator('button:has-text("إضافة الدفعة")').click();
    await page.waitForSelector("text=تم تسجيل الدفعة", { timeout: 10_000 });

    await loginAs(page, "basel"); // COLLECT_PAYMENT, no VIEW_SALE_PRICE/APPROVE_PAYMENT
    await page.goto(job.href, { waitUntil: "networkidle" });
    const bodyText = await page.innerText("main");

    expect(bodyText).not.toContain("قيمة البيع الإجمالية");
    expect(bodyText).not.toContain("6,500.00");
    // "المحصَّل" (collected-so-far) and the itemized payment list would let
    // Basel back out the exact sale price by adding it to "المتبقي" — both
    // must be absent for a viewer without VIEW_SALE_PRICE/APPROVE_PAYMENT.
    expect(bodyText).not.toContain("المحصَّل");
    expect(bodyText).not.toContain("2,000.00");
    // "المتبقي" (how much is left to collect) stays visible — a genuine
    // operational need for a COLLECT_PAYMENT holder, and on its own
    // doesn't reveal the sale price.
    expect(bodyText).toContain("المتبقي");
    expect(bodyText).toContain("4,500.00");
  });
});
