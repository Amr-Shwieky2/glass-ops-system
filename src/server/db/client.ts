import "server-only";
import { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

/**
 * Single shared Postgres pool + Drizzle client for the whole app.
 *
 * Cached on globalThis so Next.js dev-mode hot reloads reuse the same pool
 * instead of leaking a new one on every edit (the standard pattern for any
 * connection-pooling client in Next.js dev).
 */
const globalForDb = globalThis as unknown as {
  pgPool: Pool | undefined;
};

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env and set it.",
    );
  }
  return new Pool({
    connectionString,
    // Modest ceiling: this app talks to one Postgres instance from one
    // Next.js server process (self-hosted `next start`, not a fleet of
    // serverless functions each opening their own pool).
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
  });
}

const pool = globalForDb.pgPool ?? createPool();
if (process.env.NODE_ENV !== "production") {
  globalForDb.pgPool = pool;
}

export const db = drizzle(pool, { schema });

/**
 * Structural type for "a Drizzle client OR an open transaction on one" —
 * every server module that takes an optional `executor` param types it as
 * `Database` so a caller inside `db.transaction(async (tx) => ...)` can
 * pass `tx` and have the write join that same transaction. Deliberately
 * NOT `typeof db`: the real `db` object additionally carries `$client`
 * (the underlying pg Pool, for introspection only) which a transaction
 * handle doesn't have, so typing this as `typeof db` would make it
 * impossible to ever pass a `tx` in.
 */
export type Database = NodePgDatabase<typeof schema>;
