// @vitest-environment node
// WEB-ACT-12: next.config.ts sends the fixed security headers on every path, static files
// included, since the proxy, which adds the CSP, skips those.
import { expect, it } from "vitest";
import nextConfig from "./next.config";
import { FIXED_HEADERS } from "./src/shared/security-headers";

it("WEB-ACT-12 every path gets the fixed security headers, static files included", async () => {
  expect(await nextConfig.headers?.()).toEqual([
    { source: "/(.*)", headers: [...FIXED_HEADERS] },
  ]);
});
