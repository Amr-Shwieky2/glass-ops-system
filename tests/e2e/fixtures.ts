import "dotenv/config";
import { test as base, expect, type Page } from "@playwright/test";
import { Pool } from "pg";

/**
 * Shared login fixture + small DB/UI helpers reused across every spec file
 * in this suite. Modeled on the login()/jobHrefByNumber()/grant-revoke-
 * permission conventions every scripts/verify-phaseN.mjs already
 * established (phone/password login via #phone/#password, jobs found by
 * their stable seeded job_number via the UI rather than a hardcoded row
 * id, direct SQL for setup/assertions the UI doesn't surface) — just
 * expressed as an idiomatic Playwright fixture instead of copy-pasted
 * imperative script code.
 */

export const DEMO_USERS = {
  amr: { phone: "0501111111", password: "password123", name: "عمرو" },
  mohammad: { phone: "0502222222", password: "password123", name: "محمد" },
  issam: { phone: "0503333333", password: "password123", name: "عصام" },
  basel: { phone: "0504444444", password: "password123", name: "باسل" },
} as const;

export type DemoUserKey = keyof typeof DEMO_USERS;

type Creds = { phone: string; password: string };

type Fixtures = {
  /** Logs `page` in as one of the four seeded demo users (or arbitrary
   * phone/password creds) via the real login form, waiting for the
   * post-login redirect to /dashboard — the same interaction every
   * verify-phaseN.mjs's login() helper performs. */
  loginAs: (page: Page, user: DemoUserKey | Creds) => Promise<void>;
};

type WorkerFixtures = {
  /** One pooled pg connection per worker (this config runs a single
   * worker, so effectively one for the whole run) for the direct-SQL
   * setup/assertion helpers below — the same `pg` Pool every
   * verify-phaseN.mjs already uses for checks the UI doesn't surface. */
  db: Pool;
};

export const test = base.extend<Fixtures, WorkerFixtures>({
  db: [
    async ({}, use) => {
      const pool = new Pool({ connectionString: process.env.DATABASE_URL });
      await use(pool);
      await pool.end();
    },
    { scope: "worker" },
  ],

  loginAs: async ({}, use) => {
    await use(async (page: Page, user: DemoUserKey | Creds) => {
      const creds: Creds = typeof user === "string" ? DEMO_USERS[user] : user;
      // proxy.ts bounces an already-authenticated visitor away from
      // /login, so a context switch must clear cookies first or this just
      // lands back on /dashboard silently logged in as the previous user.
      await page.context().clearCookies();
      await page.goto("/login", { waitUntil: "networkidle" });
      await page.fill("#phone", creds.phone);
      await page.fill("#password", creds.password);
      await Promise.all([
        page.waitForURL("**/dashboard", { timeout: 10_000 }),
        page.click('button[type="submit"]'),
      ]);
    });
  },
});

export { expect };

// ---------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------

/** Finds a job's detail-page href by its stable seeded/created job_number,
 * via the /jobs list UI — never a hardcoded row id, so it stays valid
 * across a fresh `npm run db:seed` and across tests creating their own
 * jobs. */
export async function jobHrefByNumber(page: Page, jobNumber: string): Promise<string> {
  await page.goto("/jobs", { waitUntil: "networkidle" });
  const href = await page.locator(`a:has-text("${jobNumber}")`).first().getAttribute("href");
  if (!href) throw new Error(`Job ${jobNumber} not found in /jobs list`);
  return href;
}

/** Draws a couple of strokes on the (first) signature <canvas> so it is
 * non-empty — must scroll it into view first since page.mouse.* dispatches
 * at raw viewport coordinates and never auto-scrolls. */
export async function drawSignature(page: Page): Promise<void> {
  const canvas = page.locator("canvas").first();
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("signature canvas has no bounding box");
  await page.mouse.move(box.x + 20, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.3, { steps: 5 });
  await page.mouse.move(box.x + box.width - 20, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
}

/** Matches a formatted money figure regardless of thousands separators or
 * a leading ₪ sign, e.g. moneyPattern("1200.00") matches "1,200.00" and
 * "₪1,200.00" — the exact convention every verify-phaseN.mjs script uses. */
export function moneyPattern(amount: string): RegExp {
  const [whole, cents = "00"] = amount.split(".");
  const withCommas = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",?");
  return new RegExp(`${withCommas}\\.${cents}`);
}

let uniqueCounter = 0;
/** A fresh, valid-looking Israeli-format phone number, unique within this
 * run — every test that creates its own customer/job uses one of these so
 * repeated suite runs never collide with each other or with seed data. */
export function uniquePhone(): string {
  uniqueCounter += 1;
  const suffix = String((Date.now() + uniqueCounter) % 10_000_000).padStart(7, "0");
  return `+9725${suffix}`;
}

/** A short, human-legible unique suffix for names/titles created by this
 * run (timestamp + a per-process counter), so re-running the suite never
 * collides with a previous run's leftover rows. */
export function uniqueLabel(prefix: string): string {
  uniqueCounter += 1;
  return `${prefix} #${Date.now().toString(36)}${uniqueCounter}`;
}

export interface NewJobResult {
  jobId: string;
  jobNumber: string;
  href: string;
}

/** Creates a brand-new customer + job via the real /jobs/new form (the
 * "new lead" entry point every e2e test in this suite uses instead of
 * touching seeded data) and returns its id/number/href. Caller must
 * already be logged in as a user holding CREATE_CUSTOMER (or VIEW_ALL_JOBS
 * for an existing-customer job, not used here). */
export async function createLeadJob(
  page: Page,
  opts: { customerName: string; customerPhone: string; title: string; notes?: string },
): Promise<NewJobResult> {
  await page.goto("/jobs/new", { waitUntil: "networkidle" });
  await page.click('button:has-text("عميل جديد")');
  await page.fill("#newCustomerName", opts.customerName);
  await page.fill("#newCustomerPhone", opts.customerPhone);
  await page.fill("#title", opts.title);
  if (opts.notes) await page.fill("#notes", opts.notes);
  await Promise.all([
    page.waitForURL(/\/jobs\/[0-9a-f-]{36}$/, { timeout: 10_000 }),
    page.click('button:has-text("إنشاء المهمة")'),
  ]);
  const jobId = new URL(page.url()).pathname.split("/").pop()!;
  const jobNumber = (await page.locator("h1").first().innerText()).trim();
  return { jobId, jobNumber, href: `/jobs/${jobId}` };
}

// ---------------------------------------------------------------------
// DB helpers (direct SQL, for setup/assertions the UI doesn't surface —
// same convention as every verify-phaseN.mjs script)
// ---------------------------------------------------------------------

export async function userIdByPhone(db: Pool, phone: string): Promise<string> {
  const localPhone = phone.startsWith("0") ? `+972${phone.slice(1)}` : phone;
  const { rows } = await db.query(`select id from users where phone = $1`, [localPhone]);
  if (!rows[0]) throw new Error(`no user with phone ${phone}`);
  return rows[0].id as string;
}

export async function demoUserId(db: Pool, user: DemoUserKey): Promise<string> {
  return userIdByPhone(db, DEMO_USERS[user].phone);
}

export async function grantPermission(
  db: Pool,
  userId: string,
  key: string,
  grantedByUserId?: string,
): Promise<void> {
  const grantor = grantedByUserId ?? (await demoUserId(db, "amr"));
  await db.query(
    `insert into user_permissions (user_id, permission_key, granted_by_user_id)
     values ($1, $2, $3) on conflict do nothing`,
    [userId, key, grantor],
  );
}

export async function revokePermission(db: Pool, userId: string, key: string): Promise<void> {
  await db.query(`delete from user_permissions where user_id = $1 and permission_key = $2`, [
    userId,
    key,
  ]);
}

export async function jobIdByNumber(db: Pool, jobNumber: string): Promise<string> {
  const { rows } = await db.query(`select id from jobs where job_number = $1`, [jobNumber]);
  if (!rows[0]) throw new Error(`no job with job_number ${jobNumber}`);
  return rows[0].id as string;
}

export async function jobStatusKey(db: Pool, jobId: string): Promise<string | undefined> {
  const { rows } = await db.query(
    `select js.key from jobs j join job_statuses js on js.id = j.status_id where j.id = $1`,
    [jobId],
  );
  return rows[0]?.key;
}

export async function cashAccountId(
  db: Pool,
  ownerType: "company" | "user",
  ownerUserId?: string,
): Promise<string> {
  const { rows } =
    ownerType === "company"
      ? await db.query(`select id from cash_accounts where owner_type = 'company'`)
      : await db.query(
          `select id from cash_accounts where owner_type = 'user' and owner_user_id = $1`,
          [ownerUserId],
        );
  return rows[0]?.id;
}

export async function cashBalance(db: Pool, accountId: string): Promise<number> {
  const { rows } = await db.query(
    `select coalesce(sum(case when direction = 'in' then amount::numeric else -amount::numeric end), 0)::text as bal
     from cash_transactions where cash_account_id = $1`,
    [accountId],
  );
  return Number(rows[0].bal);
}

/** The job's remaining balance, computed the exact same way
 * src/server/payments/queries.ts's getJobPayments() does (sale price minus
 * the sum of APPROVED payments only) — queried directly rather than via
 * a page-text money regex, because a loose substring match like "0.00"
 * can spuriously match inside an unrelated larger figure (e.g. "10.00"
 * contains "0.00"). Returns null when the job has no sale price yet. */
export async function jobRemainingBalance(db: Pool, jobId: string): Promise<number | null> {
  const { rows } = await db.query(
    `select j.sale_price_total::text as sale,
            coalesce(sum(cp.amount) filter (where cp.approval_status = 'approved'), 0)::text as paid
     from jobs j
     left join customer_payments cp on cp.job_id = j.id
     where j.id = $1
     group by j.sale_price_total`,
    [jobId],
  );
  if (!rows[0] || rows[0].sale === null) return null;
  return Number(rows[0].sale) - Number(rows[0].paid);
}

export async function approvedLedgerBalance(db: Pool, userId: string): Promise<number> {
  const { rows } = await db.query(
    `select coalesce(sum(amount::numeric), 0)::text as bal from technician_ledger_entries
     where user_id = $1 and approval_status = 'approved'`,
    [userId],
  );
  return Number(rows[0].bal);
}
