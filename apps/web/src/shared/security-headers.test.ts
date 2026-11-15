// @vitest-environment node
// WEB-ACT-12: the headers every page gets, from their one source. The preview checks the deployed
// headers too (apps/web/preview/headers.spec.ts).
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  contentSecurityPolicy,
  cspSettings,
  FIXED_HEADERS,
  newNonce,
} from "./security-headers";

const supabase = "https://abcdefghijklmnopqrst.supabase.co";
const hosted = {
  supabaseUrl: supabase,
  sentryDsn: "https://abc123@o456.ingest.de.sentry.io/789",
  development: false,
};

/** Each directive's sources, by name. */
function directives(policy: string): Record<string, string[]> {
  return Object.fromEntries(
    policy.split("; ").map((directive) => {
      const [name, ...sources] = directive.split(" ");
      return [name, sources];
    }),
  );
}

describe("WEB-ACT-12 the Content Security Policy", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("WEB-ACT-12 names only the origins Curio uses, and runs scripts and styles only with the nonce", () => {
    expect(directives(contentSecurityPolicy("n0nce", hosted))).toEqual({
      "default-src": ["'self'"],
      "script-src": [
        "'self'",
        "'nonce-n0nce'",
        "'strict-dynamic'",
        "https://js.stripe.com",
        "https://challenges.cloudflare.com",
      ],
      "style-src": ["'self'", "'nonce-n0nce'"],
      // Profile photos come from Supabase Storage; the map draws from data: and blob: images.
      "img-src": ["'self'", "data:", "blob:", supabase],
      "font-src": ["'self'"],
      "connect-src": [
        "'self'",
        supabase,
        "wss://abcdefghijklmnopqrst.supabase.co",
        "https://api.mapbox.com",
        "https://events.mapbox.com",
        "https://api.stripe.com",
        "https://o456.ingest.de.sentry.io",
      ],
      "frame-src": [
        "https://js.stripe.com",
        "https://challenges.cloudflare.com",
      ],
      // Mapbox GL JS runs its workers from blob: URLs.
      "worker-src": ["blob:"],
      "object-src": ["'none'"],
      "base-uri": ["'none'"],
      "form-action": ["'self'"],
      "frame-ancestors": ["'none'"],
      "upgrade-insecure-requests": [],
    });
  });

  it("WEB-ACT-12 never allows 'unsafe-eval', 'unsafe-inline' or a wildcard in a build", () => {
    for (const settings of [
      hosted,
      { ...hosted, sentryDsn: undefined },
      {
        supabaseUrl: "http://127.0.0.1:54321",
        sentryDsn: undefined,
        development: false,
      },
    ]) {
      const policy = contentSecurityPolicy(newNonce(), settings);
      expect(policy).not.toMatch(/unsafe-eval|unsafe-inline|wasm-unsafe-eval/);
      expect(policy).not.toMatch(/(^|\s)(\*|https?:|wss?:)(\s|;|$)|\*\./);
    }
  });

  it("WEB-ACT-12 allows 'unsafe-eval' under next dev alone, where React needs it", () => {
    expect(
      directives(contentSecurityPolicy("n", { ...hosted, development: true }))[
        "script-src"
      ],
    ).toContain("'unsafe-eval'");
    vi.stubEnv("NODE_ENV", "development");
    expect(cspSettings().development).toBe(true);
    for (const build of ["production", "test"]) {
      vi.stubEnv("NODE_ENV", build);
      expect(cspSettings().development).toBe(false);
    }
  });

  it("names nothing for Supabase or Sentry when their settings are missing or won't parse", () => {
    for (const [supabaseUrl, sentryDsn] of [
      [undefined, undefined],
      ["not a url", "not a dsn"],
    ]) {
      const policy = directives(
        contentSecurityPolicy("n", {
          supabaseUrl,
          sentryDsn,
          development: false,
        }),
      );
      expect(policy["connect-src"]).toEqual([
        "'self'",
        "https://api.mapbox.com",
        "https://events.mapbox.com",
        "https://api.stripe.com",
      ]);
      expect(policy["img-src"]).toEqual(["'self'", "data:", "blob:"]);
    }
  });

  it("for the local stack or next dev, doesn't upgrade plain HTTP, and reaches the local Realtime over ws://", () => {
    expect(
      directives(contentSecurityPolicy("n", { ...hosted, development: true })),
    ).not.toHaveProperty("upgrade-insecure-requests");
    const policy = directives(
      contentSecurityPolicy("n", {
        supabaseUrl: "http://127.0.0.1:54321",
        sentryDsn: undefined,
        development: true,
      }),
    );
    expect(policy["connect-src"]).toContain("ws://127.0.0.1:54321");
    expect(policy).not.toHaveProperty("upgrade-insecure-requests");
  });

  it("WEB-ACT-12 each nonce is 128 random bits, never repeated", () => {
    const nonces = new Set(Array.from({ length: 200 }, newNonce));
    expect(nonces.size).toBe(200);
    for (const nonce of nonces)
      expect(Buffer.from(nonce, "base64")).toHaveLength(16);
  });
});

describe("WEB-ACT-12 the fixed headers", () => {
  it("WEB-ACT-12 HSTS, nosniff, the Referrer-Policy, no framing, and the camera only for Stripe", () => {
    expect(
      Object.fromEntries(FIXED_HEADERS.map(({ key, value }) => [key, value])),
    ).toEqual({
      "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "X-Frame-Options": "DENY",
      "Cross-Origin-Opener-Policy": "same-origin",
      "Permissions-Policy":
        'camera=("https://js.stripe.com"), microphone=(), geolocation=(self), payment=(), usb=(), browsing-topics=()',
    });
  });
});
