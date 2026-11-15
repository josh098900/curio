// @vitest-environment node
// WEB-ACT-11's static files, checked with Next's own matcher. It's in a file of its own because
// Next's testing helper, once loaded, breaks real proxy calls in the same file.
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { describe, expect, it } from "vitest";
import { config } from "./proxy";

describe("WEB-ACT-11 proxy.ts's matcher", () => {
  it("WEB-ACT-11 skips static files", () => {
    const runsFor = (url: string) =>
      unstable_doesMiddlewareMatch({ config, url });
    for (const url of [
      "/_next/static/chunks/main.js",
      "/_next/image?url=%2Fposter.png&w=640&q=75",
      "/favicon.ico",
      "/icons/pin.svg",
      "/posters/hike.webp",
      "/robots.txt",
      "/sitemap.xml",
      "/manifest.webmanifest",
    ])
      expect(runsFor(url), url).toBe(false);
    for (const url of [
      "/",
      "/plans",
      "/activities/5c3d",
      "/api/health",
      "/auth/confirm",
    ])
      expect(runsFor(url), url).toBe(true);
  });
});
