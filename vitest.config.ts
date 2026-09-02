import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

/**
 * Unit tests for this codebase's pure, DB-free business logic (spec
 * section 87). Node environment — this is server-side money/permission/CSV
 * logic, not React component rendering, so no jsdom/testing-library here
 * (that would be unnecessary scope for this phase; see Phase 12 for any
 * future component-testing needs).
 *
 * vite-tsconfig-paths reads tsconfig.json's `paths` so "@/server/money"
 * etc. resolve inside test files exactly as they do in the app itself —
 * no separate alias list to keep in sync by hand.
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      // See vitest-stubs/server-only.ts for why this is needed.
      "server-only": fileURLToPath(new URL("./vitest-stubs/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
