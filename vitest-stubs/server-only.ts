// Test-only stub for the `server-only` import guard.
//
// The real `server-only` package unconditionally throws on import — it's a
// build-time guard that only makes sense inside Next.js's bundler (which
// resolves it to a no-op via the "react-server" package-export condition
// for genuine server code, and lets it throw for anything accidentally
// bundled into a Client Component). Vitest runs in plain Node with neither
// of those conditions, so several of the pure modules under test here
// (e.g. src/server/auth/permissions.ts) would fail to even import.
//
// vitest.config.ts aliases the `server-only` specifier to this empty file
// for the test run only — it changes nothing about how the app itself
// resolves `server-only` in dev/build.
export {};
