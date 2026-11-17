import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { REQUEST_ID_HEADER } from "@/shared/error-reporting";
import {
  contentSecurityPolicy,
  cspSettings,
  newNonce,
} from "@/shared/security-headers";
import {
  sessionCookieOptions,
  supabaseFetch,
  supabaseSettings,
  withinSupabaseTimeout,
} from "@/shared/supabase-settings";

/**
 * Refreshes the session cookie, sets the Content Security Policy and gives the request an id, and
 * nothing else (spec §13.2, §14.3, WEB-ACT-11 and WEB-ACT-12). It never allows, redirects or blocks a request: CVE-2025-29927
 * showed a proxy can be skipped entirely, so every page, server action and route handler checks
 * the user itself. Server components can't write cookies, so this is where an expiring session is
 * refreshed before a page renders. The CSP's nonce must be new for each request, and Next stamps it
 * on a page's own scripts and styles when it finds the CSP on the request, so it's made here too.
 * The request id follows the request into every Supabase call and error report.
 */
export async function proxy(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const refreshed = await refreshSession(request, requestId);
  const nonce = newNonce();
  const policy = contentSecurityPolicy(nonce, cspSettings());

  // The page about to render sees the refreshed cookies, the CSP whose nonce Next stamps on its
  // scripts and styles, the nonce itself, for scripts a page adds (Turnstile, Stripe.js), and the
  // request id. set() replaces anything the client sent under these names.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("content-security-policy", policy);
  requestHeaders.delete("content-security-policy-report-only");
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set(REQUEST_ID_HEADER, requestId);
  const response = NextResponse.next({ request: { headers: requestHeaders } });

  // The browser gets the refreshed cookies, with the headers that stop a CDN caching the session,
  // and the CSP.
  for (const { name, value, options } of refreshed.cookies)
    response.cookies.set(name, value, options);
  for (const [header, value] of Object.entries(refreshed.headers))
    response.headers.set(header, value);
  response.headers.set("content-security-policy", policy);
  return response;
}

type Refreshed = {
  cookies: { name: string; value: string; options: CookieOptions }[];
  headers: Record<string, string>;
};

/**
 * Refreshes an expiring session, writing the new cookies into the request for the page. The answer
 * isn't used, and a failure, even settings that won't make a client, changes nothing: who's signed
 * in is decided by the page or action that runs next.
 */
async function refreshSession(
  request: NextRequest,
  requestId: string,
): Promise<Refreshed> {
  const refreshed: Refreshed = { cookies: [], headers: {} };
  const settings = supabaseSettings();
  if (!settings) return refreshed;
  try {
    const supabase = createServerClient(settings.url, settings.publishableKey, {
      cookieOptions: sessionCookieOptions(settings.url),
      global: {
        fetch: supabaseFetch,
        headers: { [REQUEST_ID_HEADER]: requestId },
      },
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet, headers) {
          for (const { name, value } of cookiesToSet)
            request.cookies.set(name, value);
          refreshed.cookies.push(...cookiesToSet);
          Object.assign(refreshed.headers, headers);
        },
      },
    });
    // A refresh and its retries get 15 seconds in all, then the page goes on (spec §14.4).
    await withinSupabaseTimeout(supabase.auth.getClaims());
  } catch {}
  return refreshed;
}

// Only Next's own static files and image route skip the proxy: they carry no session and need no
// CSP, and next.config.ts gives them the fixed headers. Everything else runs it, files named like
// images included, because a path the app doesn't know is answered with an HTML page, which needs
// the CSP (T14's security review). A file added to public/ later is excluded by its exact name.
export const config = {
  matcher: ["/((?!_next/static/|_next/image$).*)"],
};
