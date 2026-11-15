import type { NextConfig } from "next";
import { FIXED_HEADERS } from "./src/shared/security-headers";

const nextConfig: NextConfig = {
  transpilePackages: ["@curio/contracts"],
  // next dev would otherwise write an AGENTS.md into the app.
  agentRules: false,
  // The fixed security headers on every path, static files included; src/proxy.ts adds the CSP to
  // pages (src/shared/security-headers.ts, WEB-ACT-12).
  async headers() {
    return [{ source: "/(.*)", headers: [...FIXED_HEADERS] }];
  },
};

export default nextConfig;
