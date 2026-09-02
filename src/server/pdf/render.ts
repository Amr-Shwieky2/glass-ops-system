import "server-only";
import { chromium } from "playwright-core";

/**
 * Turns a self-contained HTML string into a PDF Buffer (used for the quote
 * document, section 18). Uses the Chromium that ships with playwright-core
 * rather than any external PDF library, so no paid API and no extra
 * dependency beyond what's already installed for testing (section 92).
 *
 * `executablePath` is left undefined by default so playwright-core finds
 * its own managed browser (the normal path after `npx playwright install
 * chromium` at Docker build time — see the deployment docs). Set
 * CHROMIUM_EXECUTABLE_PATH to point at a system Chromium instead (e.g. an
 * apt-installed `/usr/bin/chromium` in a slimmer image, or this dev
 * sandbox's fixed Playwright browser path).
 */
export async function renderHtmlToPdf(html: string): Promise<Buffer> {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
    args: ["--no-sandbox"], // required to launch Chromium as root in most containers
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle" });
    return await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "14mm", bottom: "14mm", left: "12mm", right: "12mm" },
    });
  } finally {
    await browser.close();
  }
}
