import {
  test,
  expect,
  createLeadJob,
  drawSignature,
  moneyPattern,
  uniquePhone,
  uniqueLabel,
} from "./fixtures";

/**
 * Spec section 87: quote version immutability, signed-quote preservation,
 * and public-token access.
 *
 * Ground truth checked directly in the source before writing these
 * assertions (not assumed from ARCHITECTURE.md's prose alone):
 *   - src/server/quotes/versions.ts's createQuoteVersion() is the ONLY
 *     writer of quote_versions rows, always an INSERT — editing a signed
 *     quote resets quotes.status back to 'draft' and bumps
 *     quotes.currentVersionId to the new row, but quotes.signedVersionId
 *     (set once, at signing) is never touched again, and the OLD version
 *     row's own items/prices/terms are never updated.
 *   - createQuoteVersion() also REVOKES the previous public signing link
 *     the moment a new version is saved (quote_public_links.revokedAt) —
 *     so the specific link the customer already signed through stops
 *     resolving to anything (public/q/[token]/page.tsx renders "تم إلغاء
 *     هذا الرابط", and its PDF route 404s) rather than silently starting
 *     to show the new, unsigned draft.
 *   - The STAFF pdf route (/api/quotes/[quoteId]/pdf,
 *     getQuoteRenderData()) is explicitly documented as rendering the
 *     quote's CURRENT version, not its signed one — so it is deliberately
 *     NOT used here to prove "what was signed never changes"; the public,
 *     token-scoped PDF captured at sign time is the one immutable
 *     artifact, and the quote_versions row itself (read directly) is the
 *     ground truth.
 */

test.describe("quote version immutability", () => {
  test("a later price edit creates a new version while the already-signed version/PDF/link stay exactly as signed", async ({
    page,
    loginAs,
    db,
  }) => {
    await loginAs(page, "mohammad");
    const job = await createLeadJob(page, {
      customerName: uniqueLabel("عميل عرض سعر"),
      customerPhone: uniquePhone(),
      title: "اختبار ثبات نسخة العرض",
    });

    // --- v1: create + send + sign -----------------------------------
    await page.click('button:has-text("إنشاء عرض سعر")');
    let dialog = page.locator('[role="dialog"]');
    await dialog.locator('input[placeholder="الوصف"]').fill("زجاج اختبار — نسخة 1");
    await dialog.locator('input[placeholder="الكمية"]').fill("1");
    await dialog.locator('input[placeholder="السعر"]').fill("500");
    await dialog.locator("#paymentTerms").fill("دفعة أولى 25% عند التوقيع.");
    await dialog.locator("#workTerms").fill("التنفيذ خلال 10 أيام عمل.");
    await dialog.locator('button:has-text("حفظ عرض السعر")').click();
    await page.waitForTimeout(700);
    let text = await page.innerText("body");
    expect(text).toContain("مسودة");
    expect(moneyPattern("500.00").test(text)).toBe(true);

    await page.click('button:has-text("إرسال للعميل")');
    await page.waitForSelector("text=رابط توقيع العرض جاهز", { timeout: 10_000 });
    const originalLink = await page.locator("input[readonly]").inputValue();
    expect(originalLink).toMatch(/\/public\/q\//);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    const customerCtx = await page.context().browser()!.newContext({ locale: "ar" });
    const customerPage = await customerCtx.newPage();
    await customerPage.goto(originalLink, { waitUntil: "networkidle" });
    text = await customerPage.innerText("body");
    expect(moneyPattern("500.00").test(text)).toBe(true);
    await drawSignature(customerPage);
    await customerPage.check("#agreedToTerms");
    await customerPage.locator('button:has-text("توقيع والموافقة على العرض")').click();
    await customerPage.waitForSelector("text=تم توقيع عرض السعر", { timeout: 10_000 });
    await customerCtx.close();

    const { rows: quoteRows1 } = await db.query(
      `select id, current_version_id, signed_version_id, status from quotes
       where job_id = $1`,
      [job.jobId],
    );
    const quoteId: string = quoteRows1[0].id;
    const signedVersionId: string = quoteRows1[0].signed_version_id;
    expect(quoteRows1[0].status).toBe("signed");
    expect(signedVersionId).toBe(quoteRows1[0].current_version_id);

    const { rows: v1ItemRows } = await db.query(
      `select description, quantity, unit_price, line_total from quote_items where quote_version_id = $1`,
      [signedVersionId],
    );
    expect(v1ItemRows).toHaveLength(1);
    expect(v1ItemRows[0].line_total).toBe("500.00");
    const { rows: v1Rows } = await db.query(
      `select total, payment_terms, work_terms from quote_versions where id = $1`,
      [signedVersionId],
    );
    expect(v1Rows[0].total).toBe("500.00");
    expect(v1Rows[0].payment_terms).toBe("دفعة أولى 25% عند التوقيع.");

    // The public PDF, captured while the link is still live, is the
    // durable proof of what was actually signed.
    const signedPdfResp = await page.request.get(`${originalLink.replace(/\/public\/q\//, "/api/public/quotes/")}/pdf`);
    expect(signedPdfResp.status()).toBe(200);
    expect((await signedPdfResp.body()).slice(0, 4).toString("latin1")).toBe("%PDF");

    // --- v2: edit the SIGNED quote -> a brand new version, different price
    await page.goto(job.href, { waitUntil: "networkidle" });
    await page.click('button:has-text("تعديل (سينشئ نسخة جديدة تحتاج توقيعاً جديداً)")');
    dialog = page.locator('[role="dialog"]');
    await dialog.locator('input[placeholder="السعر"]').fill("800");
    await dialog.locator('button:has-text("حفظ عرض السعر")').click();
    await page.waitForTimeout(700);
    text = await page.innerText("body");
    expect(text).toContain("الإصدار 2");
    expect(moneyPattern("800.00").test(text)).toBe(true);
    // Editing a signed quote resets it to draft — it needs a fresh
    // signature. Scoped to the quote card's own status badge (exact text,
    // not a substring) rather than a whole-page check for "موقّع": the
    // version-history footnote legitimately still reads "#1 (موقّعة)" —
    // the feminine form contains "موقّع" as a substring — which is
    // correct, expected history, not a bug.
    const quoteBadge = page
      .locator('[data-slot="card"]', { hasText: "عرض السعر" })
      .first()
      .locator('[data-slot="badge"]')
      .first();
    await expect(quoteBadge).toHaveText("مسودة");

    // --- the append-only guarantee, proven against the DB directly -----
    const { rows: quoteRows2 } = await db.query(
      `select current_version_id, signed_version_id, status from quotes where id = $1`,
      [quoteId],
    );
    expect(quoteRows2[0].status).toBe("draft");
    expect(quoteRows2[0].signed_version_id).toBe(signedVersionId); // untouched
    expect(quoteRows2[0].current_version_id).not.toBe(signedVersionId); // new row

    const { rows: v1RowsAfter } = await db.query(
      `select total, payment_terms, work_terms from quote_versions where id = $1`,
      [signedVersionId],
    );
    expect(v1RowsAfter[0]).toEqual(v1Rows[0]); // byte-for-byte unchanged
    const { rows: v1ItemsAfter } = await db.query(
      `select description, quantity, unit_price, line_total from quote_items where quote_version_id = $1`,
      [signedVersionId],
    );
    expect(v1ItemsAfter).toEqual(v1ItemRows);

    const { rows: signatureRows } = await db.query(
      `select quote_version_id, customer_name_at_signing from quote_signatures where quote_version_id = $1`,
      [signedVersionId],
    );
    expect(signatureRows).toHaveLength(1); // the signature stays attached to v1, not moved to v2

    // The specific link the customer already signed through is revoked,
    // not silently repointed at the new draft's price.
    const { rows: linkRows } = await db.query(
      `select revoked_at from quote_public_links where quote_id = $1 order by created_at asc limit 1`,
      [quoteId],
    );
    expect(linkRows[0].revoked_at).not.toBeNull();

    const staleCtx = await page.context().browser()!.newContext({ locale: "ar" });
    const stalePage = await staleCtx.newPage();
    await stalePage.goto(originalLink, { waitUntil: "networkidle" });
    text = await stalePage.innerText("body");
    expect(text).toContain("تم إلغاء هذا الرابط");
    expect(moneyPattern("800.00").test(text)).toBe(false); // never leaks the new draft's price
    await staleCtx.close();

    const staleSignedPdfResp = await page.request.get(
      `${originalLink.replace(/\/public\/q\//, "/api/public/quotes/")}/pdf`,
    );
    expect(staleSignedPdfResp.status()).toBe(404);
  });
});

test.describe("public quote-signing link (no login)", () => {
  test("the signing link works with no login at all, and an invalid or tampered token is rejected cleanly", async ({
    page,
    loginAs,
  }) => {
    await loginAs(page, "mohammad");
    const job = await createLeadJob(page, {
      customerName: uniqueLabel("عميل رابط عام"),
      customerPhone: uniquePhone(),
      title: "اختبار الرابط العام",
    });
    await page.click('button:has-text("إنشاء عرض سعر")');
    const dialog = page.locator('[role="dialog"]');
    await dialog.locator('input[placeholder="الوصف"]').fill("زجاج اختبار رابط عام");
    await dialog.locator('input[placeholder="الكمية"]').fill("1");
    await dialog.locator('input[placeholder="السعر"]').fill("640");
    await dialog.locator('button:has-text("حفظ عرض السعر")').click();
    await page.waitForTimeout(700);
    await page.click('button:has-text("إرسال للعميل")');
    await page.waitForSelector("text=رابط توقيع العرض جاهز", { timeout: 10_000 });
    const link = await page.locator("input[readonly]").inputValue();

    // A completely fresh, cookie-less browser context — no session, no
    // prior login of any kind — can still open and use the link.
    const anonCtx = await page.context().browser()!.newContext({ locale: "ar" });
    const anonPage = await anonCtx.newPage();
    await anonPage.goto(link, { waitUntil: "networkidle" });
    let text = await anonPage.innerText("body");
    expect(moneyPattern("640.00").test(text)).toBe(true);
    expect(text).toContain("التوقيع والموافقة");

    // An outright invalid token.
    await anonPage.goto("/public/q/this-token-does-not-exist-00000000", {
      waitUntil: "networkidle",
    });
    text = await anonPage.innerText("body");
    expect(text).toContain("الرابط غير صالح");

    // A TAMPERED token — same shape as a real one, one character flipped —
    // must fail the same clean way, not a crash/500.
    const token = link.split("/public/q/")[1];
    const tampered = (token[0] === "a" ? "b" : "a") + token.slice(1);
    const response = await anonPage.goto(`/public/q/${tampered}`, { waitUntil: "networkidle" });
    expect(response?.ok()).toBe(true);
    text = await anonPage.innerText("body");
    expect(text).toContain("الرابط غير صالح");

    await anonCtx.close();
  });
});
