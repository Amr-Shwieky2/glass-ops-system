import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { applicationSettings } from "@/server/db/schema";
import type { Database } from "@/server/db/client";
import { SETTINGS_DEFAULTS, type SettingsSchema } from "@/server/settings-defaults";

/**
 * Every adjustable business rule (section 77) lives in application_settings
 * as one JSON value per key, with a typed default in settings-defaults.ts.
 * Nothing in the app hardcodes a commission %, quote validity window, or
 * deduction default — it calls getSetting(...) instead, so a
 * Settings-screen edit takes effect everywhere immediately, no deploy.
 */
export { SETTINGS_DEFAULTS, type SettingsSchema };

export async function getSetting<K extends keyof SettingsSchema>(
  key: K,
  executor: Database = db,
): Promise<SettingsSchema[K]> {
  const rows = await executor
    .select({ value: applicationSettings.value })
    .from(applicationSettings)
    .where(eq(applicationSettings.key, key))
    .limit(1);
  if (rows.length === 0) return SETTINGS_DEFAULTS[key];
  return rows[0].value as SettingsSchema[K];
}

export async function getAllSettings(
  executor: Database = db,
): Promise<SettingsSchema> {
  const rows = await executor.select().from(applicationSettings);
  const result = { ...SETTINGS_DEFAULTS };
  for (const row of rows) {
    (result as Record<string, unknown>)[row.key] = row.value;
  }
  return result;
}

export async function setSetting<K extends keyof SettingsSchema>(
  key: K,
  value: SettingsSchema[K],
  updatedByUserId: string,
  executor: Database = db,
): Promise<void> {
  await executor
    .insert(applicationSettings)
    .values({ key, value, updatedByUserId, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: applicationSettings.key,
      set: { value, updatedByUserId, updatedAt: new Date() },
    });
}
