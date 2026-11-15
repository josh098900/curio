// The web app's security headers, from one place (spec §13.5, WEB-ACT-12). src/proxy.ts sends
// the Content Security Policy, which carries a fresh nonce for each request; next.config.ts sends
// the fixed headers on every path, static files included. Adding an origin is a decision, so ask
// (.claude/rules/web.md).
import { isLocalStack } from "./supabase-settings";

/** Stripe.js, which shows the ID check in a modal on Curio's own page (D25). */
const STRIPE_JS = "https://js.stripe.com";
const STRIPE_API = "https://api.stripe.com";
/** Cloudflare Turnstile, on sign-in (T17). */
const TURNSTILE = "https://challenges.cloudflare.com";
/** Mapbox GL JS, in a classic 2D style, which needs no WebAssembly (§13.5 A02). */
const MAPBOX = ["https://api.mapbox.com", "https://events.mapbox.com"];

export type CspSettings = {
  /** The Supabase project's address, for the Data API, Realtime and Storage. */
  supabaseUrl: string | undefined;
  /** The Sentry DSN, whose host receives error reports (T16). */
  sentryDsn: string | undefined;
  /** `next dev` only: React uses eval there for its debugging information. */
  development: boolean;
};

/** The CSP's settings, from the environment. */
export function cspSettings(): CspSettings {
  return {
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    sentryDsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    development: process.env.NODE_ENV === "development",
  };
}

/** A fresh, unguessable nonce: 128 random bits. */
export function newNonce(): string {
  return btoa(
    String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))),
  );
}

function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * The Content Security Policy for one response. Scripts and styles run only with the nonce, or
 * when a script that has it loads them ('strict-dynamic'), so injected markup can't run (§13.5
 * A05). Each other directive names only the origins Curio uses. 'unsafe-eval' is never allowed,
 * except under `next dev`, which needs it.
 */
export function contentSecurityPolicy(
  nonce: string,
  { supabaseUrl, sentryDsn, development }: CspSettings,
): string {
  const supabase = originOf(supabaseUrl);
  // Realtime: wss:// for a hosted project, ws:// for the local stack.
  const realtime = supabase?.replace(/^http/, "ws") ?? null;
  const sentry = originOf(sentryDsn);
  const local = supabaseUrl !== undefined && isLocalStack(supabaseUrl);
  const directives: [string, (string | null)[]][] = [
    ["default-src", ["'self'"]],
    [
      "script-src",
      [
        "'self'",
        `'nonce-${nonce}'`,
        "'strict-dynamic'",
        STRIPE_JS,
        TURNSTILE,
        development ? "'unsafe-eval'" : null,
      ],
    ],
    ["style-src", ["'self'", `'nonce-${nonce}'`]],
    ["img-src", ["'self'", "data:", "blob:", supabase]],
    ["font-src", ["'self'"]],
    [
      "connect-src",
      ["'self'", supabase, realtime, ...MAPBOX, STRIPE_API, sentry],
    ],
    ["frame-src", [STRIPE_JS, TURNSTILE]],
    ["worker-src", ["blob:"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'none'"]],
    ["form-action", ["'self'"]],
    ["frame-ancestors", ["'none'"]],
  ];
  const policy = directives.map(([name, sources]) =>
    [name, ...sources.filter((source) => source !== null)].join(" "),
  );
  // Every hosted site is HTTPS only. The local stack and `next dev` are plain HTTP, which this would
  // break.
  if (!local && !development) policy.push("upgrade-insecure-requests");
  return policy.join("; ");
}

/**
 * The headers every response carries, pages and static files alike (§13.5 A02 and A04, NFR-SEC-06):
 * HTTPS only for two years; no guessing content types; only the origin sent to other sites, which
 * Mapbox's URL-restricted token needs (§13.3); never framed, for older browsers that ignore
 * frame-ancestors; and the camera only for Stripe's ID check, the location only for Curio itself
 * (S15's "Use my location"), and the rest off.
 */
export const FIXED_HEADERS: readonly { key: string; value: string }[] = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Permissions-Policy",
    value: `camera=("${STRIPE_JS}"), microphone=(), geolocation=(self), payment=(), usb=(), browsing-topics=()`,
  },
];
