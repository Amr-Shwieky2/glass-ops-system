import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Minimal, self-contained production output for Docker self-hosting
  // (ARCHITECTURE.md section 9): `next build` traces and copies only the
  // files each route actually needs into `.next/standalone`, so the
  // runtime image needs no full `node_modules`/source checkout and no
  // separate hosting adapter — just `node server.js`.
  output: "standalone",
};

export default nextConfig;
