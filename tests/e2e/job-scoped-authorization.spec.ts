import { test, expect, createLeadJob, uniquePhone, uniqueLabel } from "./fixtures";
import type { Page } from "@playwright/test";

declare global {
  interface Window {
    __origFetch?: typeof fetch;
    __capturedRequests?: Array<Parameters<typeof fetch>>;
  }
}

/**
 * Regression coverage for the job-scoped/child-entity Server Action IDOR
 * audit ordered by the master execution prompt: "audit and repair every
 * job-scoped/child-entity Server Action so possession of a general
 * permission is not enough to mutate an arbitrary Job UUID or unrelated
 * child record." The fix itself is one shared helper
 * (src/server/jobs/access.ts's assertJobVisible) applied at every one of
 * ~18 call sites across jobs/actions.ts, jobs/close.ts,
 * appointments/actions.ts, payments/actions.ts, costs/actions.ts,
 * quotes/actions.ts, quotes/ai-draft-actions.ts, repairs/actions.ts,
 * production/actions.ts, and compensation/actions.ts + commission.ts.
 *
 * These two tests exercise the two DISTINCT bug classes the audit named,
 * chosen as the clearest representative of each rather than repeating the
 * same proof 18 times:
 *   1. "possession of a general permission is not enough" — a user who
 *      holds the action's permission key but has NO relationship to the
 *      target job (createRepairAction).
 *   2. "verify the child actually belongs to the referenced Job" — a
 *      caller who IS legitimately allowed to act on their OWN job, but
 *      supplies a child-entity id that actually belongs to a DIFFERENT,
 *      unrelated job (deleteJobItem).
 *
 * WHY THIS CAN'T BE TESTED BY CLICKING THROUGH THE UI ALONE: the /jobs/[id]
 * page itself already blocks navigation for an uninvolved user (proven by
 * the existing "job-visibility isolation" test in permissions.spec.ts) —
 * so the button these actions live behind is never rendered to an
 * attacker in the first place. The new server-side checks in this sprint
 * are defense-in-depth against a Server Action being invoked directly
 * (bypassing the page entirely), which by definition requires calling the
 * action itself with a tampered argument, not driving the rendered UI.
 *
 * TECHNIQUE: Next.js Server Actions POST to the current page URL with a
 * `next-action` header (a stable hash identifying which action to run)
 * and the call's own arguments serialized in the body — plain JSON for a
 * direct multi-arg call (`deleteJobItem(jobId, jobItemId)` sends body
 * `["<jobId>","<jobItemId>"]`), or FormData (with a `"0"` field holding
 * the bound leading arguments as JSON, e.g. `["<jobId>",{},"$K1"]`) for a
 * <form action={...}> call. Neither is encrypted. Each test: (a) patches
 * `window.fetch` to capture one real, legitimate invocation of the target
 * action (learning the current build's next-action hash and exact body
 * shape — this also proves the legitimate path still works), then
 * (b) replays that exact request with ONE argument tampered, still from
 * the same authenticated page context (so cookies/session are genuine,
 * same-origin, not a cross-site forgery), and (c) asserts on the
 * DATABASE — never the HTTP status alone, since a Server Action's caught
 * error still returns 200 with the ActionState error encoded in the body.
 */

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

interface CapturedFormAction {
  kind: "formdata";
  url: string;
  headers: Record<string, string>;
  entries: [string, string][];
}
interface CapturedPlainAction {
  kind: "plain";
  url: string;
  headers: Record<string, string>;
  argsJson: string;
}

/** Reads back the single most recent captured request, in a shape safe to
 * pass through Playwright's page.evaluate boundary (real FormData/Headers
 * objects can't cross it). */
async function readLastCaptured(page: Page): Promise<CapturedFormAction | CapturedPlainAction> {
  return page.evaluate(() => {
    const requests = window.__capturedRequests!;
    const [url, opts] = requests[requests.length - 1];
    const headers = Object.fromEntries(new Headers(opts?.headers).entries());
    if (opts?.body instanceof FormData) {
      return {
        kind: "formdata" as const,
        url: String(url),
        headers,
        entries: Array.from(opts.body.entries()).map(([k, v]) => [k, String(v)]) as [
          string,
          string,
        ][],
      };
    }
    return { kind: "plain" as const, url: String(url), headers, argsJson: String(opts?.body) };
  });
}

test.describe("job-scoped Server Action authorization (child-entity / job-visibility IDOR audit)", () => {
  test("a CREATE_REPAIR holder cannot open a repair on a job they have no relationship to, even via a direct tampered request", async ({
    page,
    loginAs: login,
    db,
  }) => {
    await login(page, "mohammad");

    // The victim job — Basel has zero relationship to it (not assigned,
    // not measured/priced/closed-by).
    const victimJob = await createLeadJob(page, {
      customerName: uniqueLabel("عميل ضحية"),
      customerPhone: uniquePhone(),
      title: "اختبار تفويض — لا علاقة لباسل بها",
    });

    // A second job Basel IS legitimately assigned to, so he can open its
    // page normally and trigger the real action once (to learn the
    // current build's next-action hash for createRepairAction).
    const ownJob = await createLeadJob(page, {
      customerName: uniqueLabel("عميل باسل"),
      customerPhone: uniquePhone(),
      title: "اختبار تفويض — مهمة باسل الخاصة",
    });
    await page.click('button:has-text("تعيين فني")');
    const assignDialog = page.locator('[role="dialog"]');
    await assignDialog.locator("#userId").click();
    await page.locator('[role="option"]:has-text("باسل")').click();
    await assignDialog.locator('button:has-text("تعيين"):not(:has-text("فني"))').click();
    await page.waitForTimeout(500);

    const { rows: beforeVictim } = await db.query(
      `select count(*)::int as c from repairs where job_id = $1`,
      [victimJob.jobId],
    );
    expect(beforeVictim[0].c).toBe(0);

    await login(page, "basel");
    await page.goto(ownJob.href, { waitUntil: "networkidle" });
    await patchFetchCapture(page);

    // The legitimate call, on Basel's OWN job — also proves the fix
    // doesn't break the real, authorized path.
    await page.click('button:has-text("الإبلاغ عن مشكلة")');
    const dialog = page.locator('[role="dialog"]');
    await dialog.locator("#problemDescription").fill("مشكلة حقيقية على مهمة باسل");
    await dialog.locator('button:has-text("تسجيل")').click();
    await page.waitForSelector("text=تم تسجيل الإصلاح", { timeout: 10_000 });

    const captured = await readLastCaptured(page);
    expect(captured.kind).toBe("formdata");
    const formCaptured = captured as CapturedFormAction;

    // Tamper: swap the bound jobId (field "0") from Basel's own job to
    // the victim job he has no relationship to. Every other field
    // (problemDescription etc., prefixed _1_) is replayed unchanged.
    const tamperedEntries = formCaptured.entries.map(([k, v]): [string, string] =>
      k === "0" ? [k, v.replace(ownJob.jobId, victimJob.jobId)] : [k, v],
    );
    expect(tamperedEntries.some(([k, v]) => k === "0" && v.includes(victimJob.jobId))).toBe(true);

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
      { url: formCaptured.url, headers: formCaptured.headers, entries: tamperedEntries },
    );
    expect(replayStatus).toBe(200); // Server Actions return 200 even for a caught, encoded error

    // The real assertion: no repair was created on the victim job.
    const { rows: afterVictim } = await db.query(
      `select count(*)::int as c from repairs where job_id = $1`,
      [victimJob.jobId],
    );
    expect(afterVictim[0].c).toBe(0);

    // And the legitimate call on Basel's own job DID work.
    const { rows: ownRows } = await db.query(
      `select count(*)::int as c from repairs where job_id = $1`,
      [ownJob.jobId],
    );
    expect(ownRows[0].c).toBe(1);
  });

  test("deleteJobItem refuses to delete a job item that belongs to a different job than the one claimed, even via a direct tampered request", async ({
    page,
    loginAs: login,
    db,
  }) => {
    await login(page, "mohammad");

    // Job A: the victim, with one real item on it. Mohammad (VIEW_ALL_JOBS)
    // sets it up; Issam is not involved in this job at all.
    const jobA = await createLeadJob(page, {
      customerName: uniqueLabel("عميل أ"),
      customerPhone: uniquePhone(),
      title: "اختبار تفويض — بند مهمة أخرى",
    });
    await page.click('button:has-text("إضافة بند")');
    let dialog = page.locator('[role="dialog"]');
    await dialog.locator("#description").fill("بند المهمة أ — لا يجب حذفه");
    await dialog.locator("#quantity").fill("1");
    await dialog.locator('button:has-text("إضافة البند")').click();
    await page.waitForTimeout(500);

    const { rows: itemARows } = await db.query(
      `select id from job_items where job_id = $1`,
      [jobA.jobId],
    );
    expect(itemARows).toHaveLength(1);
    const itemAId: string = itemARows[0].id;

    // Job B: Issam is legitimately involved (assigned), with its own item
    // — used only to learn the real next-action hash + body shape for
    // deleteJobItem via one genuine, harmless deletion.
    const jobB = await createLeadJob(page, {
      customerName: uniqueLabel("عميل ب"),
      customerPhone: uniquePhone(),
      title: "اختبار تفويض — مهمة عصام الخاصة",
    });
    await page.click('button:has-text("إضافة بند")');
    dialog = page.locator('[role="dialog"]');
    await dialog.locator("#description").fill("بند مهمة عصام — سيُحذف بشكل شرعي");
    await dialog.locator("#quantity").fill("1");
    await dialog.locator('button:has-text("إضافة البند")').click();
    await page.waitForTimeout(500);

    await page.click('button:has-text("تعيين فني")');
    const assignDialog = page.locator('[role="dialog"]');
    await assignDialog.locator("#userId").click();
    await page.locator('[role="option"]:has-text("عصام")').click();
    await assignDialog.locator('button:has-text("تعيين"):not(:has-text("فني"))').click();
    await page.waitForTimeout(500);

    const { rows: itemBRows } = await db.query(
      `select id from job_items where job_id = $1`,
      [jobB.jobId],
    );
    expect(itemBRows).toHaveLength(1);
    const itemBId: string = itemBRows[0].id;

    await login(page, "issam");
    await page.goto(jobB.href, { waitUntil: "networkidle" });
    await patchFetchCapture(page);

    // Legitimate deletion on Issam's own job's own item — learns the
    // real wire shape and proves the authorized path keeps working.
    const listItem = page.locator("li", { hasText: "بند مهمة عصام" });
    await listItem.locator('button[aria-label="حذف"]').click();
    await page.locator('[role="alertdialog"]').locator('button:has-text("حذف")').click();
    await page.waitForTimeout(500);

    const captured = await readLastCaptured(page);
    expect(captured.kind).toBe("plain");
    const plainCaptured = captured as CapturedPlainAction;
    const originalArgs: unknown = JSON.parse(plainCaptured.argsJson);
    expect(originalArgs).toEqual([jobB.jobId, itemBId]);

    // Tamper: keep jobId = jobB (Issam's own, legitimately visible — so
    // the job-visibility check trivially passes) but swap the jobItemId
    // to Job A's item, which Issam has no relationship to whatsoever.
    // This is exactly the "child doesn't belong to the referenced job"
    // shape the master execution prompt named.
    const tamperedArgsJson = JSON.stringify([jobB.jobId, itemAId]);

    const replayStatus = await page.evaluate(
      async ({ url, headers, body }) => {
        const res = await window.__origFetch!(url, {
          method: "POST",
          headers: {
            "next-action": headers["next-action"],
            accept: headers["accept"],
            "content-type": headers["content-type"] ?? "text/plain;charset=UTF-8",
          },
          body,
        });
        return res.status;
      },
      { url: plainCaptured.url, headers: plainCaptured.headers, body: tamperedArgsJson },
    );
    expect(replayStatus).toBe(200);

    // The real assertion: Job A's item is untouched.
    const { rows: itemAAfter } = await db.query(
      `select id from job_items where id = $1`,
      [itemAId],
    );
    expect(itemAAfter).toHaveLength(1);

    // And the legitimate deletion on Job B DID go through.
    const { rows: itemBAfter } = await db.query(
      `select id from job_items where id = $1`,
      [itemBId],
    );
    expect(itemBAfter).toHaveLength(0);
  });
});
