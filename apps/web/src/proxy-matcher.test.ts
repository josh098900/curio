// @vitest-environment node
// WEB-ACT-11's static files and WEB-ACT-12's every page, checked with Next's own matcher. It's in
// a file of its own because Next's testing helper, once loaded, breaks real proxy calls in the
// same file.
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { describe, expect, it } from "vitest";
import { config } from "./proxy";

describe("WEB-ACT-11 proxy.ts's matcher", () => {
  const runsFor = (url: string) =>
    unstable_doesMiddlewareMatch({ config, url });

  it("WEB-ACT-11 skips Next's static files", () => {
    for (const url of [
      "/_next/static/chunks/main.js",
      "/_next/static/media/plex-sans.woff2",
      "/_next/image?url=%2Fposter.png&w=640&q=75",
    ])
      expect(runsFor(url), url).toBe(false);
  });

  it("WEB-ACT-12 runs for every page, including paths named like files, which the app answers with a page", () => {
    for (const url of [
      "/",
      "/plans",
      "/activities/5c3d",
      "/api/health",
      "/auth/confirm",
      "/activities/5c3d/x.png",
      "/plans.txt",
      "/favicon.ico",
      "/favicon.ico-x",
      "/robots.txt",
      "/sitemap.xml",
      "/_next/staticx",
      "/_next/images",
    ])
      expect(runsFor(url), url).toBe(true);
  });
});
