import {
  test,
  expect,
  demoUserId,
  uniquePhone,
  uniqueLabel,
} from "./fixtures";

/**
 * New Measurement quick-submit flow (docs/superpowers/specs/
 * 2026-09-03-new-measurement-quick-submit-design.md), spec section 9's
 * Playwright plan: a technician in the field, with no prior office
 * involvement, submits one form that creates a customer (or reuses one), a
 * job at field_submission_pending, a measurement, and its attachments, all
 * in one action.
 *
 * Ports the meaningful scenarios already proven manually by
 * scripts/verify-req3-quick-measurement.mjs (43 checks against a real
 * browser + the live DB) into this project's real, registered test suite
 * — that script stays in place as supplementary deep coverage, matching
 * every other phase's verify-phaseN.mjs convention; this file is what
 * `npx playwright test` actually runs, and is the permanent regression
 * lock (most importantly for the image/svg+xml security fix in Part
 * "server-side file validation" below).
 *
 * Every test creates its own fresh customer/job via a unique phone number
 * (uniquePhone()) — never touches the seeded JOB-2026-0009 field-
 * measurement demo job (سامر خطيب) or any other shared fixture, matching
 * this suite's established convention (see tests/e2e/repairs.spec.ts /
 * permissions.spec.ts).
 */

// Same 1x1 PNG placeholder this codebase's own seed.ts and the standalone
// verify script already use as a stand-in for "a real, decodable image
// file" — all the server-side check actually inspects is the browser-
// declared File.type, not real image-content sniffing.
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const TINY_PNG_BUFFER = Buffer.from(TINY_PNG_BASE64, "base64");

/** Fills out and submits the /my-day/new-measurement form exactly as a
 * field technician would, and returns the id of the newly created job the
 * server action redirects to. Caller must already be logged in as a
 * CREATE_MEASUREMENT holder. uniquePhone() already returns a normalized
 * "+9725XXXXXXX" string (no leading-zero/formatting to strip), so it can
 * be used directly both as the form input and for DB lookups afterward. */
async function submitNewMeasurement(
  page: import("@playwright/test").Page,
  opts: {
    phone: string;
    customerName?: string;
    glassTypeLabel?: string;
    fileName?: string;
    fileMimeType?: string;
    fileBuffer?: Buffer;
    notes?: string;
    price?: string;
    priceIncludesVat?: boolean;
  },
): Promise<string> {
  await page.goto("/my-day/new-measurement", { waitUntil: "networkidle" });
  await page.fill("#phone", opts.phone);
  if (opts.customerName) await page.fill("#customerName", opts.customerName);
  if (opts.glassTypeLabel) {
    await page.click("#glassTypeId");
    await page.locator(`[role="option"]:has-text("${opts.glassTypeLabel}")`).click();
  }
  await page.setInputFiles("#files", [
    {
      name: opts.fileName ?? "site-photo.png",
      mimeType: opts.fileMimeType ?? "image/png",
      buffer: opts.fileBuffer ?? TINY_PNG_BUFFER,
    },
  ]);
  if (opts.notes) await page.fill("#notes", opts.notes);
  if (opts.price) {
    await page.fill("#price", opts.price);
    await page.click(
      opts.priceIncludesVat
        ? 'button:has-text("شامل الضريبة")'
        : 'button:has-text("قبل الضريبة")',
    );
  }

  await Promise.all([
    page.waitForURL(/\/jobs\/[0-9a-fA-F-]{36}$/, { timeout: 15_000 }),
    page.click('button:has-text("إرسال القياس")'),
  ]);
  await page.waitForSelector("text=تم إرسال القياس الميداني بنجاح", { timeout: 10_000 });
  return new URL(page.url()).pathname.split("/").pop()!;
}

/**
 * Rewrites one named part of an already-built multipart/form-data POST
 * body, replacing its filename/Content-Type/content while leaving every
 * other part (including whatever internal field(s) Next.js's Server
 * Actions wire protocol relies on to route the request) byte-for-byte
 * untouched. Ported from scripts/verify-req3-quick-measurement.mjs, which
 * proved this technique against this exact route: it simulates a client
 * that bypassed new-measurement-form.tsx's own client-side file-type
 * check — a real attacker controls the raw HTTP request, not just the
 * form fields React renders — while still routing through the exact same
 * real request the legitimate browser submission was about to send.
 */
function replaceMultipartFilePart(
  originalBuffer: Buffer,
  contentTypeHeader: string | undefined,
  fieldName: string,
  newFileName: string,
  newMimeType: string,
  newContentBuffer: Buffer,
): Buffer | null {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentTypeHeader ?? "");
  if (!boundaryMatch) return null;
  const boundary = (boundaryMatch[1] ?? boundaryMatch[2]).trim();
  const boundaryMarker = Buffer.from(`--${boundary}`);
  const CRLFCRLF = Buffer.from("\r\n\r\n");

  const markerPositions: number[] = [];
  let pos = 0;
  while (true) {
    const idx = originalBuffer.indexOf(boundaryMarker, pos);
    if (idx === -1) break;
    markerPositions.push(idx);
    pos = idx + boundaryMarker.length;
  }
  if (markerPositions.length < 2) return null;

  for (let i = 0; i < markerPositions.length - 1; i++) {
    const segStart = markerPositions[i];
    const segEnd = markerPositions[i + 1];
    const segment = originalBuffer.subarray(segStart, segEnd);
    const headerEnd = segment.indexOf(CRLFCRLF);
    if (headerEnd === -1) continue;
    const headerStr = segment.subarray(0, headerEnd).toString("latin1");
    // React's Server Actions wire protocol prefixes every field name with a
    // per-form id (e.g. "files" is actually sent as "_1_files") so multiple
    // forms/action instances on a page don't collide — match by suffix,
    // not exact name, and reuse whatever the real captured name was so the
    // server's own prefix-stripping still resolves it to "files".
    const nameMatch = headerStr.match(new RegExp(`name="([^"]*${fieldName})"`));
    if (!nameMatch || !headerStr.includes("filename=")) continue;
    const actualFieldName = nameMatch[1];

    const newDisposition = `Content-Disposition: form-data; name="${actualFieldName}"; filename="${newFileName}"`;
    const newHeaderStr = `${boundaryMarker.toString("latin1")}\r\n${newDisposition}\r\nContent-Type: ${newMimeType}`;
    const before = originalBuffer.subarray(0, segStart);
    const after = originalBuffer.subarray(segEnd);
    return Buffer.concat([
      before,
      Buffer.from(newHeaderStr, "latin1"),
      CRLFCRLF,
      newContentBuffer,
      Buffer.from("\r\n"),
      after,
    ]);
  }
  return null;
}

/** Submits /my-day/new-measurement with a legitimate PNG so the client-
 * side check passes and the real request fires, then swaps the uploaded
 * file's name/MIME type/bytes in flight via page.route — simulating an
 * attacker who bypassed the browser's <input accept> and the React check
 * entirely. Returns whether the tamper actually applied and whether the
 * server rejected the (now-disallowed) file. */
async function submitWithTamperedFile(
  page: import("@playwright/test").Page,
  opts: {
    phone: string;
    tamperedFileName: string;
    tamperedMimeType: string;
    tamperedContent: Buffer;
  },
): Promise<{ tampered: boolean; rejected: boolean }> {
  await page.goto("/my-day/new-measurement", { waitUntil: "networkidle" });

  const isNewMeasurementPost = (url: URL) => url.pathname === "/my-day/new-measurement";
  let tampered = false;
  await page.route(isNewMeasurementPost, async (route) => {
    const req = route.request();
    if (req.method() !== "POST") {
      await route.continue();
      return;
    }
    const headers = await req.allHeaders();
    const contentType = headers["content-type"] ?? "";
    const body = req.postDataBuffer();
    if (!body || !contentType.includes("multipart/form-data")) {
      await route.continue();
      return;
    }
    const newBody = replaceMultipartFilePart(
      body,
      contentType,
      "files",
      opts.tamperedFileName,
      opts.tamperedMimeType,
      opts.tamperedContent,
    );
    if (!newBody) {
      await route.continue();
      return;
    }
    tampered = true;
    await route.continue({ postData: newBody });
  });

  await page.fill("#phone", opts.phone);
  await page.setInputFiles("#files", [
    { name: "legit.png", mimeType: "image/png", buffer: TINY_PNG_BUFFER },
  ]);
  await page.click('button:has-text("إرسال القياس")');

  const rejected = await page
    .waitForSelector("text=غير مدعوم", { timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  await page.unroute(isNewMeasurementPost);

  return { tampered, rejected };
}

test.describe("New Measurement quick-submit (field origination)", () => {
  test("a CREATE_MEASUREMENT-only technician (Basel) submits a field measurement with an attachment end-to-end, creating correct job/customer/measurement/attachment rows", async ({
    page,
    loginAs,
    db,
  }) => {
    const baselId = await demoUserId(db, "basel");
    await loginAs(page, "basel");

    // My Day surfaces the quick action for a CREATE_MEASUREMENT holder
    // (spec section 7 step 1).
    await page.goto("/my-day", { waitUntil: "networkidle" });
    await expect(page.locator('a:has-text("قياس جديد")')).toHaveCount(1);

    const phone = uniquePhone();
    const customerName = uniqueLabel("زبون ميداني");
    const jobId = await submitNewMeasurement(page, {
      phone,
      customerName,
      glassTypeLabel: "مقسّى",
      fileName: "site-photo.png",
      notes: "معاينة ميدانية اختبارية: كسر في زجاج المطبخ.",
      price: "1200",
      priceIncludesVat: true,
    });

    const { rows: jobRows } = await db.query(
      `select j.customer_id, j.measured_by_user_id, j.pricing_responsible_user_id, j.title,
              js.key as status_key
       from jobs j join job_statuses js on js.id = j.status_id where j.id = $1`,
      [jobId],
    );
    const job = jobRows[0];
    expect(job?.status_key).toBe("field_submission_pending");
    expect(job?.measured_by_user_id).toBe(baselId);
    // pricingResponsibleUserId is deliberately left unset — a broadcast to
    // every CREATE_PRICE holder, not an assignment to one person.
    expect(job?.pricing_responsible_user_id).toBeNull();
    expect(job?.title).toBeNull();

    const { rows: customerRows } = await db.query(
      `select id, name from customers where phone = $1 and deleted_at is null`,
      [phone],
    );
    expect(customerRows).toHaveLength(1);
    expect(customerRows[0].id).toBe(job?.customer_id);
    expect(customerRows[0].name).toBe(customerName);

    const { rows: measurementRows } = await db.query(
      `select m.id, m.measured_by_user_id, m.photos_taken,
              m.field_quoted_price, m.field_quoted_price_includes_vat,
              gt.label_ar as glass_type_label
       from measurements m
       left join glass_types gt on gt.id = m.glass_type_id
       where m.job_id = $1`,
      [jobId],
    );
    expect(measurementRows).toHaveLength(1);
    const measurement = measurementRows[0];
    expect(measurement.measured_by_user_id).toBe(baselId);
    expect(measurement.photos_taken).toBe(true);
    expect(measurement.glass_type_label).toBe("مقسّى");
    expect(measurement.field_quoted_price).toBe("1200.00");
    expect(measurement.field_quoted_price_includes_vat).toBe(true);

    const { rows: attachmentRows } = await db.query(
      `select file_name, mime_type, size_bytes from measurement_attachments where measurement_id = $1`,
      [measurement.id],
    );
    expect(attachmentRows).toHaveLength(1);
    expect(attachmentRows[0].file_name).toBe("site-photo.png");
    expect(attachmentRows[0].mime_type).toBe("image/png");
    expect(Number(attachmentRows[0].size_bytes)).toBe(TINY_PNG_BUFFER.length);

    // Job detail page renders the field-submission data, explicitly
    // labeled as a non-binding reference price (spec section 7 step 4).
    const jobPageText = await page.innerText("body");
    expect(jobPageText).toContain("مقسّى");
    expect(jobPageText).toContain("سعر مرجعي من الميدان");
    expect(jobPageText).toContain("غير ملزم");
    expect(jobPageText).toContain("site-photo.png");
  });

  test("a second submission with the same phone reuses the existing customer instead of creating a duplicate", async ({
    page,
    loginAs,
    db,
  }) => {
    await loginAs(page, "basel");
    const phone = uniquePhone();
    const customerName = uniqueLabel("زبون متكرر");

    const jobId1 = await submitNewMeasurement(page, {
      phone,
      customerName,
      fileName: "first-visit.png",
    });
    // Deliberately leave customerName blank on the second visit — a repeat
    // caller shouldn't need to resupply it, and the existing customer's
    // name must not be overwritten by this second, name-less submission.
    const jobId2 = await submitNewMeasurement(page, {
      phone,
      fileName: "second-visit.png",
    });
    expect(jobId2).not.toBe(jobId1);

    const { rows: customerRows } = await db.query(
      `select id, name from customers where phone = $1 and deleted_at is null`,
      [phone],
    );
    expect(customerRows).toHaveLength(1); // no duplicate created
    expect(customerRows[0].name).toBe(customerName); // preserved from the first submission

    const { rows: jobRows } = await db.query(
      `select id, customer_id from jobs where id in ($1, $2)`,
      [jobId1, jobId2],
    );
    expect(jobRows).toHaveLength(2);
    const customerIds = new Set(jobRows.map((r) => r.customer_id as string));
    expect(customerIds.size).toBe(1); // both jobs linked to the SAME customer
    expect([...customerIds][0]).toBe(customerRows[0].id);
  });

  test("the job appears in the dashboard's Needs Attention panel and in /jobs filtered to the new status", async ({
    page,
    loginAs,
    db,
  }) => {
    await loginAs(page, "basel");
    const phone = uniquePhone();
    const jobId = await submitNewMeasurement(page, {
      phone,
      customerName: uniqueLabel("زبون لوحة المتابعة"),
    });

    const { rows } = await db.query(`select job_number from jobs where id = $1`, [jobId]);
    const jobNumber = rows[0].job_number as string;

    await loginAs(page, "amr"); // VIEW_ALL_JOBS + CREATE_PRICE
    await page.goto("/dashboard", { waitUntil: "networkidle" });
    const dashboardText = await page.innerText("body");
    expect(dashboardText).toContain("قياسات ميدانية بانتظار المراجعة");
    expect(dashboardText).toContain(jobNumber);

    await page.goto("/jobs?status=field_submission_pending", { waitUntil: "networkidle" });
    const jobsListText = await page.innerText("body");
    expect(jobsListText).toContain(jobNumber);
  });

  test("attachment retrieval succeeds for an authorized viewer and is rejected for an uninvolved, unauthorized one", async ({
    page,
    loginAs,
    db,
  }) => {
    await loginAs(page, "basel");
    const phone = uniquePhone();
    const jobId = await submitNewMeasurement(page, {
      phone,
      customerName: uniqueLabel("زبون مرفق"),
      fileName: "attachment-test.png",
    });

    const { rows: attachmentRows } = await db.query(
      `select ma.id
       from measurement_attachments ma
       join measurements m on m.id = ma.measurement_id
       where m.job_id = $1`,
      [jobId],
    );
    expect(attachmentRows).toHaveLength(1);
    const attachmentId = attachmentRows[0].id as string;
    const attachmentUrl = `/api/attachments/${attachmentId}`;

    await loginAs(page, "amr"); // VIEW_ALL_JOBS
    const authorizedResp = await page.request.get(attachmentUrl);
    expect(authorizedResp.status()).toBe(200);
    expect(authorizedResp.headers()["content-type"]).toBe("image/png");
    const body = await authorizedResp.body();
    expect(body.equals(TINY_PNG_BUFFER)).toBe(true);

    await loginAs(page, "issam"); // VIEW_ASSIGNED_JOBS only, not involved in this job
    const unauthorizedResp = await page.request.get(attachmentUrl);
    expect(unauthorizedResp.status()).toBe(403);
  });

  test("cancelling a field-submission job behaves exactly like cancelling any other job", async ({
    page,
    loginAs,
    db,
  }) => {
    await loginAs(page, "basel");
    const phone = uniquePhone();
    const jobId = await submitNewMeasurement(page, {
      phone,
      customerName: uniqueLabel("زبون إلغاء"),
    });

    await loginAs(page, "amr"); // CLOSE_DEAL holder
    await page.goto(`/jobs/${jobId}`, { waitUntil: "networkidle" });
    await expect(page.locator('button:has-text("إلغاء المهمة")')).toHaveCount(1);

    await page.click('button:has-text("إلغاء المهمة")');
    const dialog = page.locator('[role="dialog"]');
    const cancelReason = uniqueLabel("سبب إلغاء اختباري");
    await dialog.locator("#reason").fill(cancelReason);
    await dialog.locator('button:has-text("تأكيد إلغاء المهمة")').click();
    await page.waitForSelector('[role="dialog"]', { state: "hidden", timeout: 10_000 });
    await page.waitForTimeout(400);

    const { rows } = await db.query(
      `select js.key as status_key, j.notes
       from jobs j join job_statuses js on js.id = j.status_id where j.id = $1`,
      [jobId],
    );
    expect(rows[0]?.status_key).toBe("cancelled"); // same terminal status as any other job
    expect((rows[0]?.notes as string | null) ?? "").toContain(cancelReason);
  });
});

test.describe("server-side file validation survives a client-side bypass (security regression)", () => {
  test("a disallowed executable MIME type is rejected even after passing the client-side check via a network-level tamper", async ({
    page,
    loginAs,
    db,
  }) => {
    await loginAs(page, "basel");
    const phone = uniquePhone();

    const { tampered, rejected } = await submitWithTamperedFile(page, {
      phone,
      tamperedFileName: "malware.exe",
      tamperedMimeType: "application/x-msdownload",
      tamperedContent: Buffer.from("MZ-this-is-not-an-image-or-pdf"),
    });
    expect(tampered).toBe(true); // sanity: the tamper actually applied
    expect(rejected).toBe(true);
    // The rejected submission created nothing.
    expect(/\/jobs\/[0-9a-fA-F-]{36}$/.test(new URL(page.url()).pathname)).toBe(false);
    const { rows } = await db.query(`select id from customers where phone = $1`, [phone]);
    expect(rows).toHaveLength(0);
  });

  // The security fix that just landed: image/svg+xml is a script-capable
  // XML document, not a pixel format — the attachment route serves files
  // back `inline` with the stored MIME type, so accepting SVG would be a
  // stored-XSS hole for whoever later opens the attachment. It must be
  // rejected server-side even though it starts with "image/", which the
  // naive `type.startsWith("image/")` check a browser-declared Content-
  // Type would otherwise pass. This is the permanent-suite regression lock
  // for that fix (see also the pure-logic unit test in
  // src/server/storage/attachments.test.ts).
  test("image/svg+xml is rejected server-side even though it starts with 'image/'", async ({
    page,
    loginAs,
    db,
  }) => {
    await loginAs(page, "basel");
    const phone = uniquePhone();

    const { tampered, rejected } = await submitWithTamperedFile(page, {
      phone,
      tamperedFileName: "payload.svg",
      tamperedMimeType: "image/svg+xml",
      tamperedContent: Buffer.from(
        "<svg xmlns='http://www.w3.org/2000/svg'><script>alert(document.cookie)</script></svg>",
      ),
    });
    expect(tampered).toBe(true); // sanity: the tamper actually applied
    expect(rejected).toBe(true);
    expect(/\/jobs\/[0-9a-fA-F-]{36}$/.test(new URL(page.url()).pathname)).toBe(false);
    const { rows } = await db.query(`select id from customers where phone = $1`, [phone]);
    expect(rows).toHaveLength(0);
  });
});
