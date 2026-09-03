import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Minimal, self-contained production output for Docker self-hosting
  // (ARCHITECTURE.md section 9): `next build` traces and copies only the
  // files each route actually needs into `.next/standalone`, so the
  // runtime image needs no full `node_modules`/source checkout and no
  // separate hosting adapter — just `node server.js`.
  output: "standalone",
  experimental: {
    serverActions: {
      // Server Actions default to a 1MB request body cap. The New
      // Measurement quick-submit flow (docs/superpowers/specs/
      // 2026-09-03-new-measurement-quick-submit-design.md section 5)
      // submits up to 5 files at 15MB each — 75MB of raw file bytes alone
      // — straight through a Server Action's FormData, so the default cap
      // would reject a full submission long before
      // submitFieldMeasurementAction's own size/count validation ever
      // runs. Sized for 5x15MB plus multipart framing overhead and a
      // margin, not a tighter per-flow limit — this is a global Next.js
      // setting, not something the action can override per-call.
      bodySizeLimit: "90mb",
    },
  },
};

export default nextConfig;
