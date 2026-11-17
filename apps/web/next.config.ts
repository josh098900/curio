import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";
import { FIXED_HEADERS } from "./src/shared/security-headers";

const nextConfig: NextConfig = {
  transpilePackages: ["@curio/contracts"],
  // next dev would otherwise write an AGENTS.md into the app.
  agentRules: false,
  // No "X-Powered-By: Next.js" (ZAP's low alert 10037, T14).
  poweredByHeader: false,
  // The fixed security headers on every path, static files included; src/proxy.ts adds the CSP to
  // pages (src/shared/security-headers.ts, WEB-ACT-12).
  async headers() {
    return [{ source: "/(.*)", headers: [...FIXED_HEADERS] }];
  },
};

// Sentry's build step (spec §14.3). With SENTRY_AUTH_TOKEN (§13.3), it uploads the source maps to
// the SENTRY_ORG and SENTRY_PROJECT named, under the commit, and deletes them from the build;
// without it, nothing is uploaded. Curio doesn't trace, so that code is left out of the browser's
// Sentry chunk, and Sentry's own build telemetry is off.
export default withSentryConfig(nextConfig, {
  telemetry: false,
  bundleSizeOptimizations: {
    excludeDebugStatements: true,
    excludeTracing: true,
  },
});
