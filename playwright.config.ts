import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright Test config for the real e2e suite (spec section 87's list +
 * the full Ahmad worked example, spec section 72).
 *
 * NO `webServer` block, deliberately: a typical fresh `npm init playwright`
 * setup has Playwright spawn (and tear down) its own dev server for the
 * run. Here the Next.js dev server (Turbopack, hot-reloading) is already
 * running at http://localhost:3000 as a long-lived process this task must
 * not touch — a second `next dev` would collide on port 3000 and fail to
 * bind, and killing/restarting the existing one would yank the ground out
 * from under the two other agents working in parallel against the same
 * server. So `baseURL` just points at it directly and every test assumes
 * it is already up (see AGENTS.md / the task brief: "do NOT start a second
 * one; check /tmp/glass-dev.log if it seems down").
 *
 * Workers are pinned to 1 (fullyParallel: false) on purpose, not as a
 * safe default: this suite's permission-denial checks repeatedly grant/
 * revoke permissions on the shared seeded demo users (Basel/Mohammad/
 * Issam) via direct SQL, mirroring the established scripts/verify-phase*
 * .mjs pattern (temporarily revoke -> assert -> restore). Two of those
 * revoke/restore windows overlapping across parallel workers would race
 * and corrupt each other's assertions AND the shared seed data other
 * phases' scripts depend on — so the whole suite runs strictly serially,
 * one test at a time, same spirit as `node scripts/verify-phaseN.mjs`
 * being run one at a time today.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  outputDir: "test-results",
  use: {
    baseURL: "http://localhost:3000",
    locale: "ar",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
